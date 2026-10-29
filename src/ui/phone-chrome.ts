import { isPhoneUI } from './device-ui';

export function bindPhoneLibrary(root: HTMLElement) {
  const sidebar = root.querySelector<HTMLElement>('.library-sidebar')!;
  const backdrop = root.querySelector<HTMLElement>('.phone-navigation-backdrop')!;
  const abort = new AbortController();
  const sync = () => {
    const phone = isPhoneUI(), open = sidebar.classList.contains('mobile-open');
    sidebar.inert = phone && !open;
    backdrop.hidden = !phone || !open;
    root.querySelectorAll('[data-action=mobile-menu]').forEach(button => button.setAttribute('aria-expanded', String(open)));
  };
  const observer = new MutationObserver(sync);
  observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('notelin-device-ui', sync, { signal: abort.signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isPhoneUI() && sidebar.classList.contains('mobile-open')) {
      sidebar.classList.remove('mobile-open'); root.querySelector<HTMLButtonElement>('[data-action=mobile-menu]')?.focus();
    }
  }, { signal: abort.signal });
  sync();
  return () => { observer.disconnect(); abort.abort(); sidebar.inert = false; };
}

export function bindPhoneEditor(root: HTMLElement, signal: AbortSignal) {
  const panel = root.querySelector<HTMLElement>('.phone-document-panel')!;
  const trigger = root.querySelector<HTMLButtonElement>('[data-action=phone-document-menu]')!;
  const actions = root.querySelector<HTMLElement>('.editor-header-actions')!;
  const view = actions.querySelector('[data-action=view-options]')!;
  const primary = panel.querySelector('.phone-document-primary')!;
  const secondary = panel.querySelector('.phone-document-secondary')!;
  const moved = new Map<HTMLElement, Comment>();
  const move = (node: HTMLElement, parent: Element, before?: Element) => {
    if (!moved.has(node)) { const marker = document.createComment('tablet control'); node.before(marker); moved.set(node, marker); }
    parent.insertBefore(node, before || null);
  };
  const sync = () => {
    if (panel.matches(':popover-open')) panel.hidePopover();
    if (isPhoneUI()) {
      for (const action of ['undo', 'redo']) {
        const node = root.querySelector<HTMLElement>(`[data-action=${action}]`)!;
        move(node, actions, view);
      }
      move(root.querySelector<HTMLElement>('.editor-page-controls')!, primary);
      for (const action of ['save', 'sidebar', 'search', 'study-browser', 'export', 'settings']) {
        const node = root.querySelector<HTMLElement>(`[data-action=${action}]`);
        if (node) move(node, secondary);
      }
    } else {
      for (const [node, marker] of moved) { if (node.isConnected) marker.after(node); marker.remove(); }
      moved.clear();
    }
  };
  trigger.addEventListener('click', () => panel.togglePopover(), { signal });
  panel.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(panel.matches(':popover-open'))), { signal });
  // Dismiss before the editor opens a modal or starts an action. Existing
  // controls and listeners are retained when moving between phone and tablet UI.
  panel.addEventListener('click', event => {
    if ((event.target as Element).closest('button[data-action]')) panel.hidePopover();
  }, { capture: true, signal });
  window.addEventListener('notelin-device-ui', sync, { signal });
  sync();
}
