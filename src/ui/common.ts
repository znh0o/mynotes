import { createElement, BookOpen, Library, Folder, Star, Clock, Trash2, Plus, Search, Settings2, Upload, Download, ChevronDown, ChevronLeft, ChevronRight, Check, X, MoreHorizontal, Grid2X2, List, PenLine, Feather, Highlighter, Eraser, Lasso, Shapes, Type, Image, Hand, Undo2, Redo2, Maximize, Minimize, PanelLeft, Copy, CopyPlus, Minus, FileText, ArrowUp, ArrowDown, WifiOff, HardDrive, ShieldCheck, ArrowUpRight, Menu, FolderPlus, RefreshCw, HelpCircle, ExternalLink, LayoutTemplate, Move, Pencil, Sun, Moon, Monitor } from 'lucide';
import { trackDialog } from './history';
const iconSet = { BookOpen, Library, Folder, Star, Clock, Trash2, Plus, Search, Settings2, Upload, Download, ChevronDown, ChevronLeft, ChevronRight, Check, X, MoreHorizontal, Grid2X2, List, PenLine, Feather, Highlighter, Eraser, Lasso, Shapes, Type, Image, Hand, Undo2, Redo2, Maximize, Minimize, PanelLeft, Copy, CopyPlus, Minus, FileText, ArrowUp, ArrowDown, WifiOff, HardDrive, ShieldCheck, ArrowUpRight, Menu, FolderPlus, RefreshCw, HelpCircle, ExternalLink, LayoutTemplate, Move, Pencil, Sun, Moon, Monitor };
export type IconName = keyof typeof iconSet;
export function icon(name: IconName, size = 20) { const [tag, attrs, children] = iconSet[name]; return createElement([tag, { ...attrs, width: size, height: size, 'stroke-width': 1.7, 'aria-hidden': 'true' }, children]).outerHTML; }
export const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const safeColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : '#b9cee5';
export function button(name: IconName, title: string, action: string, extra = '') { return `<button class="icon-button" type="button" title="${escape(title)}" aria-label="${escape(title)}" data-action="${action}" ${extra}>${icon(name)}</button>`; }
let toastTimer: ReturnType<typeof setTimeout>;
export function toast(message: string, error = false) {
  const el = document.querySelector<HTMLElement>('#toast')!; el.textContent = message; el.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', error ? 8000 : 3500);
}
export function report(error: unknown) { console.error(error); toast(error instanceof Error ? error.message : '작업을 완료하지 못했어요. 다시 시도해 주세요.', true); }
export function run(action: () => Promise<unknown>) { void action().catch(report); }
export function modal(title: string, content: string, submitLabel: string, submit: (form: FormData, dialog: HTMLDialogElement) => Promise<void> | void) {
  const dialog = document.createElement('dialog'); dialog.className = 'modal';
  dialog.innerHTML = `<form><header><div><h2>${escape(title)}</h2></div><button type="button" class="icon-button" data-close aria-label="닫기">${icon('X')}</button></header><div class="modal-body">${content}</div><footer><button type="button" class="button secondary" data-close>취소</button><button type="submit" class="button primary">${escape(submitLabel)}</button></footer></form>`;
  dialog.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => dialog.close()));
  const keyboardState = window as Window & { __notelinKeyboardInset?: number; __notelinKeyboardUsableHeight?: number };
  const fitKeyboard = () => {
    const viewport = window.visualViewport;
    const density = window.devicePixelRatio || 1;
    const nativeVisible = keyboardState.__notelinKeyboardInset
      ? (keyboardState.__notelinKeyboardUsableHeight ?? Infinity) / density : Infinity;
    const visible = Math.min(window.innerHeight, viewport?.height ?? Infinity, nativeVisible);
    const keyboardOpen = Number(keyboardState.__notelinKeyboardInset || 0) / density > 100
      || window.innerHeight - (viewport?.height ?? window.innerHeight) > 100;
    dialog.classList.toggle('keyboard-open', keyboardOpen);
    dialog.style.setProperty('--modal-visible-height', `${Math.max(120, visible)}px`);
    dialog.style.setProperty('--modal-center-y', `${(viewport?.offsetTop ?? 0) + visible / 2}px`);
  };
  window.addEventListener('notelin-keyboard-inset', fitKeyboard);
  window.visualViewport?.addEventListener('resize', fitKeyboard);
  dialog.addEventListener('close', () => {
    window.removeEventListener('notelin-keyboard-inset', fitKeyboard);
    window.visualViewport?.removeEventListener('resize', fitKeyboard);
    dialog.remove();
  });
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); const m = e as MouseEvent; if (m.clientX < r.left || m.clientX > r.right || m.clientY < r.top || m.clientY > r.bottom) dialog.close(); } });
  dialog.querySelector('form')!.addEventListener('submit', async e => {
    e.preventDefault(); const btn = dialog.querySelector<HTMLButtonElement>('[type=submit]')!;
    btn.disabled = true;
    try { await submit(new FormData(e.target as HTMLFormElement), dialog); dialog.close(); }
    catch (error) { report(error); } finally { btn.disabled = false; }
  });
  document.body.append(dialog); dialog.showModal(); fitKeyboard(); trackDialog(dialog); return dialog;
}
export function confirmAction(title: string, description: string, label: string, action: () => Promise<void>) {
  return modal(title, `<p class="dialog-description">${escape(description)}</p>`, label, action);
}
export function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); }, { once: true });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
    input.click();
  });
}
export function contextMenu(anchor: HTMLElement, items: { label: string; icon: IconName; action: () => void; danger?: boolean }[]) {
  document.querySelector('.context-menu')?.remove();
  const menu = document.createElement('div'); menu.className = 'context-menu'; menu.setAttribute('role', 'menu');
  for (const item of items) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.className = item.danger ? 'danger' : ''; b.innerHTML = `${icon(item.icon, 17)}${escape(item.label)}`;
    b.onclick = () => { menu.remove(); item.action(); }; menu.append(b);
  }
  const r = anchor.getBoundingClientRect(); document.body.append(menu);
  menu.style.left = `${Math.max(8, Math.min(r.right - 188, innerWidth - 204))}px`;
  menu.style.top = `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 12)}px`;
  const outside = (e: Event) => { if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('pointerdown', outside); } };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
}
export function formatDate(value: number) {
  const elapsed = Date.now() - value;
  if (elapsed < 60000) return '방금 전'; if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}분 전`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}시간 전`;
  return new Intl.DateTimeFormat('ko', { month: 'short', day: 'numeric' }).format(value);
}
