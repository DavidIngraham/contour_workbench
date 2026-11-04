/** Installation and independent, durable per-window application updates. */
import { projectStorageCompatibility } from './pwa-compatibility';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface Release {
  version: string;
  compatibility: string;
  pageCached?: boolean;
}

function releaseOf(worker: ServiceWorker, pageVersion?: string): Promise<Release | undefined> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (release?: Release) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(release);
    };
    const timer = setTimeout(() => finish(), 1500);
    channel.port1.onmessage = event => {
      const data = event.data;
      finish(typeof data?.version === 'string' ? data : undefined);
    };
    try {
      worker.postMessage({ type: 'GET_RELEASE', pageVersion }, [channel.port2]);
    } catch {
      finish();
    }
  });
}

/** Return false when an already-installed release supersedes this page before startup. */
export async function setupPwa(prepareUpdate: () => Promise<boolean>): Promise<boolean> {
  const button = document.querySelector<HTMLButtonElement>('#install-app')!;
  const message = document.querySelector<HTMLElement>('#pwa-status')!;
  const banner = document.querySelector<HTMLElement>('#pwa-update-banner')!;
  const updateMessage = document.querySelector<HTMLElement>('#pwa-update-message')!;
  const reloadButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-pwa-reload]')];
  let prompt: InstallPrompt | undefined;
  const standalone = matchMedia('(display-mode: standalone)');
  const hideInstall = () => {
    prompt = undefined;
    button.classList.add('hidden');
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    if (standalone.matches) return;
    prompt = event as InstallPrompt;
    button.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', hideInstall);
  standalone.addEventListener('change', () => {
    if (standalone.matches) hideInstall();
  });
  button.onclick = async () => {
    const pending = prompt;
    if (!pending) return;
    hideInstall();
    try {
      await pending.prompt();
      await pending.userChoice;
    } catch {
      message.textContent = 'Use your browser’s menu to install Contour Workbench.';
    }
  };
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return true;
  const ownVersion = document.querySelector<HTMLMetaElement>(
    'meta[name="workbench-release"]',
  )?.content;
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  const workerUrl = new URL('sw.js', base);
  let pending: Release | undefined;
  let preparing = false;
  let reloading = false;
  let booting = true;
  let incompatibleUpdate = false;
  let lastInteraction = 0;
  let pointerActive = false;
  let retryAt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const interaction = () => {
    lastInteraction = Date.now();
  };
  for (const event of ['pointerdown', 'pointerup', 'pointercancel', 'keydown', 'input', 'wheel'])
    document.addEventListener(event, interaction, { capture: true, passive: true });
  document.addEventListener(
    'pointerdown',
    () => {
      pointerActive = true;
    },
    true,
  );
  for (const event of ['pointerup', 'pointercancel'])
    document.addEventListener(
      event,
      () => {
        pointerActive = false;
      },
      true,
    );
  const showProblem = (text: string) => {
    message.textContent = text;
    updateMessage.textContent = text;
    banner.classList.remove('hidden');
    reloadButtons.forEach(button => button.classList.remove('hidden'));
  };
  const schedule = () => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void maybeReload(), 1000);
  };
  const maybeReload = async () => {
    if (!pending || reloading || preparing) return;
    const editing = document.activeElement?.matches(
      'input, textarea, select, [contenteditable="true"]',
    );
    if (
      document.visibilityState === 'hidden' ||
      Date.now() < retryAt ||
      Date.now() - lastInteraction < 2000 ||
      pointerActive ||
      editing
    ) {
      schedule();
      return;
    }
    preparing = true;
    const interactionAtStart = lastInteraction;
    try {
      if (!booting && !(await prepareUpdate())) {
        schedule();
        return;
      }
      // A save may take time. Never reload over an interaction that happened during it.
      if (lastInteraction !== interactionAtStart || document.hidden) {
        schedule();
        return;
      }
      reloading = true;
      location.reload();
    } catch (error) {
      retryAt = Date.now() + 30000;
      showProblem(
        error instanceof Error ? error.message : 'Save a project backup before updating.',
      );
      schedule();
    } finally {
      preparing = false;
    }
  };
  const inspectController = async () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker || worker.scriptURL !== workerUrl.href) return;
    // Announce before querying, including when this page is older than its controller.
    if (ownVersion) worker.postMessage({ type: 'CLIENT_RELEASE', version: ownVersion });
    const release = await releaseOf(worker, ownVersion);
    if (worker !== navigator.serviceWorker.controller || !release || !ownVersion) return;
    if (release.version === ownVersion) {
      pending = undefined;
      if (!incompatibleUpdate) {
        banner.classList.add('hidden');
        message.textContent =
          'Ready to reopen local projects offline. Updates happen automatically.';
      }
      return;
    }
    if (release.compatibility !== String(projectStorageCompatibility)) return;
    // A hard refresh can load newer network HTML before its worker is installed.
    // Only supersede a page whose release this worker knows was already installed.
    if (release.pageCached !== true) return;
    pending = release;
    await maybeReload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => void inspectController());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void inspectController();
  });
  window.addEventListener('pageshow', () => void inspectController());
  document.addEventListener('resume', () => void inspectController());
  window.addEventListener('online', () => {
    if (registration) void checkForUpdate(true);
    else void register();
  });
  reloadButtons.forEach(button => {
    button.onclick = () => {
      retryAt = 0;
      lastInteraction = 0;
      if (pending) void maybeReload();
      else void checkForUpdate(true);
    };
  });
  let registration: ServiceWorkerRegistration | undefined;
  let checking = false;
  let lastCheck = 0;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  const checkForUpdate = async (force = false) => {
    if (!registration || checking || !navigator.onLine) return;
    if (!force && Date.now() - lastCheck < 60000) return;
    checking = true;
    lastCheck = Date.now();
    try {
      await registration.update();
    } catch {
      // A failed download leaves the complete active release usable. Retry quietly.
    } finally {
      checking = false;
      void inspectController();
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => void checkForUpdate(), 60000);
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  const register = () =>
    navigator.serviceWorker
      .register(workerUrl, {
        scope: base.pathname,
        updateViaCache: 'none',
      })
      .then(value => {
        registration = value;
        const watch = () => {
          const worker = registration?.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'activated') void inspectController();
            if (worker.state === 'installed') void showIncompatibleUpdate();
          });
        };
        const showIncompatibleUpdate = async () => {
          const waiting = registration?.waiting;
          if (!waiting) return;
          const release = await releaseOf(waiting);
          if (release && release.compatibility !== String(projectStorageCompatibility)) {
            incompatibleUpdate = true;
            showProblem(
              'An update is ready. Close other Workbench windows, then reopen the app when your work is saved.',
            );
          }
        };
        watch();
        registration.addEventListener('updatefound', watch);
        void showIncompatibleUpdate();
        void checkForUpdate();
        return inspectController();
      })
      .catch(() => {
        // Registration can fail offline; the existing page remains usable.
        clearTimeout(checkTimer);
        checkTimer = setTimeout(() => void register(), 60000);
      });
  const registered = register();
  // Do not hold startup behind a slow network. A ready controller is checked first
  // so refreshing a staged release avoids booting the obsolete model workspace.
  await Promise.race([
    Promise.all([inspectController(), registered]),
    new Promise<void>(resolve => setTimeout(resolve, 500)),
  ]);
  booting = false;
  return !reloading;
}
