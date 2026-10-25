interface ChromeActions {
  newProject: () => void;
  panel: (name: string) => void;
}

/** Bind command menus, command mirrors, and native utility dialogs. */
export function setupWorkbenchChrome(actions: ChromeActions) {
  const menus = [...document.querySelectorAll<HTMLDetailsElement>('.command-menu')];
  const closeMenus = (except?: HTMLDetailsElement) => {
    menus.forEach(menu => {
      if (menu !== except) menu.open = false;
    });
  };
  const proxies = [...document.querySelectorAll<HTMLButtonElement>('[data-command]')];
  const sync = () => {
    proxies.forEach(button => {
      const target = document.getElementById(button.dataset.command!) as HTMLButtonElement | null;
      if (!target) return;
      if (button.disabled !== target.disabled) button.disabled = target.disabled;
      if (button.title !== target.title) button.title = target.title;
      const pressed = target.getAttribute('aria-pressed');
      if (pressed !== null && button.getAttribute('aria-pressed') !== pressed)
        button.setAttribute('aria-pressed', pressed);
    });
  };
  const observer = new MutationObserver(sync);
  const targets = new Set(proxies.map(button => document.getElementById(button.dataset.command!)));
  for (const target of targets) {
    if (target)
      observer.observe(target, {
        attributes: true,
        attributeFilter: ['disabled', 'title', 'aria-pressed'],
      });
  }
  menus.forEach(menu => {
    menu.querySelector('summary')!.addEventListener('click', () => {
      closeMenus(menu);
      sync();
    });
    menu.addEventListener('keydown', event => {
      const buttons = [
        ...menu.querySelectorAll<HTMLButtonElement>('.command-popup button:not(:disabled)'),
      ].filter(button => !button.closest('.hidden'));
      if (event.key === 'Escape') {
        event.preventDefault();
        menu.open = false;
        menu.querySelector('summary')!.focus();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        closeMenus(menu);
        menu.open = true;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : event.key === 'ArrowDown'
                ? (index + 1) % buttons.length
                : (index - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const next =
          menus[
            (menus.indexOf(menu) + (event.key === 'ArrowRight' ? 1 : menus.length - 1)) %
              menus.length
          ];
        closeMenus(next);
        next.open = true;
        next.querySelector('summary')!.focus();
      }
    });
    menu.addEventListener('focusout', event => {
      if (event.relatedTarget && !menu.contains(event.relatedTarget as Node)) menu.open = false;
    });
  });
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (!target.closest('.command-menu')) closeMenus();
    const button = target.closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const menu = button.closest<HTMLDetailsElement>('.command-menu');
    if (menu) {
      menu.open = false;
      menu.querySelector('summary')!.focus();
    }
    if (button.dataset.command) {
      // The real command owns validation and model changes; mirrors never duplicate that logic.
      (document.getElementById(button.dataset.command) as HTMLButtonElement | null)?.click();
    } else if (button.dataset.panel) {
      actions.panel(button.dataset.panel);
    } else if (button.dataset.dialog) {
      const dialog = document.getElementById(button.dataset.dialog) as HTMLDialogElement;
      if (!dialog.open) dialog.showModal();
      if (button.dataset.helpSection) document.getElementById(button.dataset.helpSection)?.focus();
    } else if (button.hasAttribute('data-close-dialog')) {
      button.closest('dialog')?.close();
    }
  });
  document.getElementById('new-project')!.onclick = actions.newProject;
  document.querySelectorAll<HTMLDialogElement>('.utility-dialog').forEach(dialog => {
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') event.stopPropagation();
    });
  });
  for (const id of ['contours', 'topo-map', 'wireframe']) {
    const button = document.getElementById(id)!;
    button.addEventListener('click', () =>
      button.setAttribute('aria-pressed', String(button.classList.contains('active'))),
    );
  }
  sync();
}
