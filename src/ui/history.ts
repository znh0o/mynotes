export type AppRoute = { screen: 'library'; filter: string } | { screen: 'note'; id: string };
export type Direction = 'forward' | 'back' | 'none';
interface Entry { mynotes: 1; index: number; route: AppRoute; overlay?: string }
const homeRoute: AppRoute = { screen: 'library', filter: 'all' };
const same = (a: AppRoute, b: AppRoute) => JSON.stringify(a) === JSON.stringify(b);
const valid = (state: unknown): state is Entry => {
  const value = state as Entry | null;
  return value?.mynotes === 1 && Number.isInteger(value.index) && value.index >= 0 &&
    (value.route?.screen === 'library' && typeof value.route.filter === 'string' || value.route?.screen === 'note' && typeof value.route.id === 'string');
};
let activeHistory: AppHistory | undefined;
export function trackDialog(dialog: HTMLDialogElement) { activeHistory?.trackDialog(dialog); }

// All entries use the same static-host URL. A home guard stays below the app's
// screen history, so Android/browser Back navigates within this document.
export class AppHistory {
  private entry!: Entry;
  private libraryIndex = 1;
  private queue = Promise.resolve();
  private dialogs = new Map<string, HTMLDialogElement>();
  private backWaiters: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  private moving = Promise.resolve();
  private moved?: () => void;
  constructor(private render: (route: AppRoute, direction: Direction) => Promise<void>, private error: (error: unknown) => void, private atHome: () => void) {
    activeHistory = this;
    history.scrollRestoration = 'manual';
    window.addEventListener('popstate', event => this.pop(event.state));
  }
  async start() {
    history.replaceState({ mynotes: 1, index: 0, route: homeRoute }, '', location.pathname + location.search);
    this.entry = { mynotes: 1, index: 1, route: homeRoute }; history.pushState(this.entry, '');
    this.libraryIndex = this.entry.index;
    await this.render(homeRoute, 'none');
  }
  private enqueue(action: () => Promise<void>) {
    const operation = this.queue.then(action);
    this.queue = operation.catch(() => {}); return operation;
  }
  async navigate(route: AppRoute, direction: Direction = 'forward') {
    await this.moving;
    return this.enqueue(async () => {
      if (same(route, this.entry.route) && !this.entry.overlay) return;
      const previous = this.entry;
      const replace = !!previous.overlay || previous.route.screen === 'note' && route.screen === 'note';
      this.closeDialogs();
      this.entry = { mynotes: 1, index: previous.index + (replace ? 0 : 1), route };
      (replace ? history.replaceState.bind(history) : history.pushState.bind(history))(this.entry, '');
      try {
        await this.render(route, direction);
        if (route.screen === 'library') this.libraryIndex = this.entry.index;
      } catch (error) {
        this.entry = previous; history.replaceState(previous, ''); throw error;
      }
    });
  }
  async goHome() {
    await this.moving;
    await this.queue;
    if (this.entry.route.screen === 'library') return;
    this.closeDialogs();
    document.querySelector('.context-menu')?.remove();
    const distance = this.entry.index - this.libraryIndex;
    if (distance <= 0) return this.navigate(homeRoute, 'back');
    return new Promise<void>((resolve, reject) => { this.backWaiters.push({ resolve, reject }); history.go(-distance); });
  }
  trackDialog(dialog: HTMLDialogElement) {
    if (!this.entry) return;
    if (this.moved) { void this.moving.then(() => { if (dialog.open) this.trackDialog(dialog); }); return; }
    const id = crypto.randomUUID(); this.dialogs.set(id, dialog);
    this.entry = { ...this.entry, index: this.entry.index + 1, overlay: id };
    history.pushState(this.entry, '');
    dialog.addEventListener('close', () => {
      const tracked = this.dialogs.delete(id);
      if (tracked && this.entry.overlay === id) {
        this.moving = new Promise(resolve => this.moved = resolve); history.back();
      }
    }, { once: true });
  }
  private closeDialogs(keep?: string) {
    for (const [id, dialog] of this.dialogs) if (id !== keep) {
      this.dialogs.delete(id); if (dialog.open) dialog.close();
    }
  }
  private pop(state: unknown) {
    this.moved?.(); this.moved = undefined; this.moving = Promise.resolve();
    const previous = this.entry;
    let target: Entry = valid(state) ? state : { mynotes: 1, index: 0, route: homeRoute };
    const menu = document.querySelector('.context-menu');
    const eraser = document.querySelector<HTMLElement>('.eraser-picker:popover-open');
    const pen = document.querySelector<HTMLElement>('.pen-picker:popover-open');
    const shape = document.querySelector<HTMLElement>('.shape-picker:popover-open');
    const image = document.querySelector<HTMLElement>('.image-picker:popover-open');
    const color = document.querySelector<HTMLElement>('.color-picker-dialog:popover-open');
    const sidebar = document.querySelector('.library-sidebar.mobile-open');
    const profile = document.querySelector<HTMLElement>('.profile-popover:not([hidden])');
    if ((menu || eraser || pen || shape || image || color || sidebar || profile) && !previous.overlay) {
      menu?.remove(); eraser?.hidePopover(); shape?.hidePopover(); image?.hidePopover(); color?.hidePopover(); if (!color) pen?.hidePopover(); sidebar?.classList.remove('mobile-open');
      if (profile) { profile.hidden = true; document.querySelector('.avatar')?.setAttribute('aria-expanded', 'false'); }
      this.entry = { ...previous, index: target.index + 1 }; history.pushState(this.entry, ''); return;
    }
    if (target.index === 0) {
      target = { mynotes: 1, index: 1, route: homeRoute }; history.pushState(target, ''); this.atHome();
    }
    if (target.overlay && !this.dialogs.has(target.overlay)) {
      target = { ...target, overlay: undefined }; history.replaceState(target, '');
    }
    this.entry = target; this.closeDialogs(target.overlay);
    const waiters = this.backWaiters.splice(0);
    const task = this.enqueue(async () => {
      if (!same(previous.route, target.route)) await this.render(target.route, target.index < previous.index ? 'back' : 'forward');
      if (target.route.screen === 'library') this.libraryIndex = target.index;
    });
    void task.then(() => waiters.forEach(w => w.resolve())).catch(error => {
      this.entry = { ...previous, index: target.index + 1, overlay: undefined };
      history.pushState(this.entry, ''); waiters.forEach(w => w.reject(error)); this.error(error);
    });
  }
}
