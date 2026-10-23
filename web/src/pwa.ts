/** Install affordance and non-disruptive app updates; model storage remains in IndexedDB. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function setupPwa() {
  const button = document.querySelector<HTMLButtonElement>('#install-app')!;
  const message = document.querySelector<HTMLElement>('#pwa-status')!;
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
  void navigator.serviceWorker
    .register(new URL('sw.js', base), {
      scope: base.pathname,
      updateViaCache: 'none',
    })
    .then(registration => {
      const showUpdate = () => {
        if (registration.waiting && navigator.serviceWorker.controller)
          message.textContent =
            'An update is ready. Let your project finish saving, then close all Contour Workbench windows and reopen to update.';
      };
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
