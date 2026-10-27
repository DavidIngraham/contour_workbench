/** Install affordance and non-disruptive app updates; model storage remains in IndexedDB. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Connect installation and explicit updates to the application's durable-save boundary. */
export function setupPwa(prepareUpdate: () => Promise<void>) {
  const button = document.querySelector<HTMLButtonElement>('#install-app')!;
  const message = document.querySelector<HTMLElement>('#pwa-status')!;
  const banner = document.querySelector<HTMLElement>('#pwa-update-banner')!;
  const updateMessage = document.querySelector<HTMLElement>('#pwa-update-message')!;
  const reloadButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-pwa-reload]')];
  const progress = document.querySelector<HTMLDialogElement>('#pwa-update-progress')!;
  let updating = false;
  let updatePostponed = false;
  let preparedRequest: string | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const showMessage = (text: string) => {
    message.textContent = text;
    updateMessage.textContent = text;
  };
  const finish = () => {
    updating = false;
    preparedRequest = undefined;
    clearTimeout(recoveryTimer);
    progress.close();
    reloadButtons.forEach(button => {
      button.disabled = false;
    });
  };
  const begin = () => {
    updating = true;
    updatePostponed = false;
    reloadButtons.forEach(button => {
      button.disabled = true;
    });
    if (!progress.open) progress.showModal();
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      finish();
      updatePostponed = true;
      showMessage('The update did not finish. Check the other Workbench windows, then try again.');
    }, 30000);
  };
  progress.addEventListener('cancel', event => event.preventDefault());
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
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  const workerUrl = new URL('sw.js', base);
  // Browser reload is an explicit request for the current release, including
  // hard reloads that temporarily bypass the controlling worker.
  const browserReload =
    (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
      ?.type === 'reload';
  navigator.serviceWorker.addEventListener('message', event => {
    const worker = event.source as ServiceWorker | null;
    if (!worker || worker.scriptURL !== workerUrl.href) return;
    const data = event.data;
    if (data?.type === 'PREPARE_UPDATE' && typeof data.requestId === 'string') {
      if (preparedRequest === data.requestId) return;
      preparedRequest = data.requestId;
      begin();
      void (async () => {
        try {
          await prepareUpdate();
          if (preparedRequest === data.requestId)
            worker.postMessage({ type: 'UPDATE_READY', requestId: data.requestId });
        } catch (error) {
          worker.postMessage({
            type: 'UPDATE_BLOCKED',
            requestId: data.requestId,
            reason: error instanceof Error ? error.message : 'A project could not be saved.',
          });
        }
      })();
    } else if (
      data?.type === 'UPDATE_CANCELED' &&
      (!preparedRequest || data.requestId === preparedRequest)
    ) {
      finish();
      updatePostponed = true;
      banner.classList.remove('hidden');
      showMessage(`Update postponed: ${data.reason}`);
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only windows that acknowledged a durable save participate in an explicit update.
    if (preparedRequest) location.reload();
  });
  void navigator.serviceWorker
    .register(workerUrl, {
      scope: base.pathname,
      updateViaCache: 'none',
    })
    .then(registration => {
      let reloadUpdateRequested = false;
      let pendingApply = false;
      const applyUpdate = () => {
        if (updating) return;
        if (!registration.waiting) {
          pendingApply = true;
          void registration
            .update()
            .then(showUpdate)
            .catch(() => {});
          return;
        }
        pendingApply = false;
        begin();
        registration.waiting.postMessage({ type: 'APPLY_UPDATE' });
      };
      const showUpdate = () => {
        if (registration.waiting) {
          banner.classList.remove('hidden');
          reloadButtons.forEach(button => {
            button.classList.remove('hidden');
          });
          if (!updating && !updatePostponed)
            showMessage(
              'An update is ready. Reload saves projects and updates all open Workbench windows.',
            );
          if (pendingApply || (browserReload && !reloadUpdateRequested)) {
            reloadUpdateRequested = true;
            applyUpdate();
          }
        }
      };
      reloadButtons.forEach(button => {
        button.onclick = applyUpdate;
      });
      showUpdate();
      const watchInstallation = () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'redundant' && !navigator.serviceWorker.controller)
            message.textContent =
              'Offline setup could not finish. Reopen while online to try again.';
          showUpdate();
        });
      };
      watchInstallation();
      registration.addEventListener('updatefound', watchInstallation);
      // Do not rely on the browser's periodic worker-update schedule after reload.
      if (browserReload)
        void registration
          .update()
          .then(showUpdate)
          .catch(() => {});
      void navigator.serviceWorker.ready.then(() => {
        if (!message.textContent) message.textContent = 'Ready to reopen local projects offline.';
        showUpdate();
      });
      // Recheck when returning to a long-running installed app; never reload active work.
      let lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60 * 60 * 1000) {
          lastCheck = Date.now();
          void registration.update().catch(() => {});
        }
      });
    })
    .catch(() => {
      message.textContent = 'Offline setup could not finish. Reopen while online to try again.';
    });
}
