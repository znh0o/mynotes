import { uid, type Point, type TextItem } from '../data/model';
import { InkEngine } from '../engine/InkEngine';
import { textFont, textLines } from '../engine/text';
import { icon } from './common';

export class InlineTextEditor {
  private layer: HTMLDivElement;
  private toolbar: HTMLDivElement;
  private box?: HTMLDivElement;
  private input?: HTMLTextAreaElement;
  private draft?: TextItem;
  private abort = new AbortController();
  private scale = 1;
  private composing = false;
  private measure = document.createElement('canvas').getContext('2d')!;
  private defaults = { size: 22, bold: false, italic: false, align: 'left' as TextItem['align'] };
  constructor(private surface: HTMLElement, shell: HTMLElement, private engine: InkEngine) {
    this.layer = document.createElement('div'); this.layer.className = 'page-text-layer'; surface.append(this.layer);
    this.toolbar = document.createElement('div'); this.toolbar.className = 'inline-text-toolbar'; this.toolbar.hidden = true;
    this.toolbar.setAttribute('role', 'toolbar'); this.toolbar.setAttribute('aria-label', '글자 서식');
    this.toolbar.innerHTML = `<label>크기<input type="number" min="10" max="100" step="1" value="22" aria-label="글자 크기" /></label><button type="button" data-text="bold" aria-label="굵게" aria-pressed="false"><b>B</b></button><button type="button" data-text="italic" aria-label="기울임" aria-pressed="false"><i>I</i></button><select aria-label="글자 정렬"><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select><button type="button" data-text="delete" aria-label="글상자 삭제">${icon('Trash2', 18)}</button><button type="button" data-text="cancel" aria-label="입력 취소">${icon('X', 18)}</button><button type="button" data-text="done" class="text-done">${icon('Check', 18)}<span>입력 완료</span></button>`;
    shell.append(this.toolbar);
    const signal = this.abort.signal;
    // Keep the native keyboard/caret when a formatting button is tapped.
    this.toolbar.addEventListener('pointerdown', event => { if ((event.target as Element).closest('button')) event.preventDefault(); }, { signal });
    this.toolbar.addEventListener('click', event => {
      const action = (event.target as Element).closest<HTMLElement>('[data-text]')?.dataset.text;
      if (!action || !this.draft) return;
      if (action === 'done' || action === 'cancel') { this.finish(action === 'cancel'); return; }
      if (action === 'delete') { this.input!.value = ''; this.finish(); return; }
      if (action === 'bold' || action === 'italic') this.draft[action] = !this.draft[action];
      this.sync(); this.publish(); this.input?.focus({ preventScroll: true });
    }, { signal });
    this.toolbar.addEventListener('input', () => {
      if (!this.draft) return;
      const size = Number(this.toolbar.querySelector('input')!.value);
      if (Number.isFinite(size) && size >= 10 && size <= 100) this.draft.size = size;
      this.draft.align = this.toolbar.querySelector('select')!.value as TextItem['align'];
      this.sync(); this.publish();
    }, { signal });
    document.addEventListener('pointerdown', event => {
      if (!this.draft || !(event.target instanceof Element)) return;
      if (event.target.closest('.inline-text-box,.inline-text-toolbar,.ink-toolbar')) return;
      this.finish();
    }, { signal, capture: true });
    document.addEventListener('keydown', event => {
      if (!this.draft || this.composing || event.isComposing) return;
      if (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault(); event.stopImmediatePropagation(); this.finish(event.key === 'Escape');
      }
    }, { signal, capture: true });
    window.visualViewport?.addEventListener('resize', () => { this.positionToolbar(); this.ensureCaretVisible(); }, { signal });
    window.visualViewport?.addEventListener('scroll', () => this.positionToolbar(), { signal });
  }
  get active() { return !!this.draft; }
  setScale(scale: number) {
    this.scale = scale;
    this.layer.style.width = `${this.engine.page.width}px`; this.layer.style.height = `${this.engine.page.height}px`;
    this.layer.style.transform = `scale(${scale})`;
  }
  open(point: Point) {
    this.finish();
    const page = this.engine.page;
    const item = [...page.items].reverse().find((i): i is TextItem => i.kind === 'text' && point.x >= i.x - 8 && point.x <= i.x + i.w + 8 && point.y >= i.y - 8 && point.y <= i.y + i.h + 8);
    const x = item?.x ?? Math.max(16, Math.min(point.x, page.width - 136));
    const y = item?.y ?? Math.max(16, Math.min(point.y, page.height - 60));
    const surface = this.surface.getBoundingClientRect(), viewport = this.surface.closest('.paper-viewport')!.getBoundingClientRect();
    const visibleWidth = Math.max(100, (Math.min(surface.right, viewport.right) - surface.left - x * this.scale - 24) / this.scale);
    this.draft = item ? { ...item, wrap: true, w: Math.max(100, Math.min(item.w, page.width - x - 16)) } : { id: uid(), kind: 'text', x, y, w: Math.min(560, visibleWidth, page.width - x - 24), h: 40, text: '', color: this.engine.options.color, wrap: true, ...this.defaults };
    this.engine.beginText(this.draft.id);
    this.box = document.createElement('div'); this.box.className = 'inline-text-box';
    this.box.innerHTML = `<button type="button" class="text-move-handle" aria-label="글상자 이동">${icon('Move', 14)}<span>드래그로 이동</span></button><textarea class="inline-text-input" aria-label="페이지에 글 입력" placeholder="여기에 입력하세요" spellcheck="false" enterkeyhint="enter"></textarea><button type="button" class="text-resize-handle" aria-label="글상자 너비 조절">${icon('ChevronRight', 16)}</button>`;
    this.layer.append(this.box); this.input = this.box.querySelector('textarea')!; this.input.value = this.draft.text;
    this.input.addEventListener('input', () => { if (this.draft) { this.draft.text = this.input!.value; this.sync(); this.ensureCaretVisible(); if (!this.composing) this.publish(); } });
    this.input.addEventListener('compositionstart', () => this.composing = true);
    this.input.addEventListener('compositionend', () => { this.composing = false; if (this.draft) { this.draft.text = this.input!.value; this.sync(); this.publish(); } });
    this.input.addEventListener('keyup', () => this.ensureCaretVisible());
    this.drag(this.box.querySelector('.text-move-handle')!, false);
    this.drag(this.box.querySelector('.text-resize-handle')!, true);
    this.toolbar.hidden = false; this.sync(); this.positionToolbar();
    this.input.focus({ preventScroll: true });
    if (item) {
      const ctx = this.measure; ctx.font = textFont(this.draft);
      const lines = textLines(this.draft, text => ctx.measureText(text).width);
      const row = Math.max(0, Math.min(lines.length - 1, Math.floor((point.y - this.draft.y) / (this.draft.size * 1.55))));
      let offset = 0;
      for (let i = 0; i < row; i++) { offset += lines[i].length; if (this.draft.text[offset] === '\n') offset++; }
      const width = ctx.measureText(lines[row]).width;
      const left = this.draft.align === 'center' ? (this.draft.w - width) / 2 : this.draft.align === 'right' ? this.draft.w - width : 0;
      const x = point.x - this.draft.x - left;
      let prefix = '';
      for (const character of lines[row]) {
        if (x < (ctx.measureText(prefix).width + ctx.measureText(prefix + character).width) / 2) break;
        prefix += character;
      }
      offset += prefix.length; this.input.setSelectionRange(offset, offset);
    }
    this.ensureCaretVisible();
  }
  setColor(color: string) { if (this.draft) { this.draft.color = color; this.sync(); this.publish(); } }
  private sync() {
    const item = this.draft; if (!item || !this.input || !this.box) return;
    this.defaults = { size: item.size, bold: !!item.bold, italic: !!item.italic, align: item.align ?? 'left' };
    Object.assign(this.box.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.w}px` });
    Object.assign(this.input.style, { font: textFont(item), lineHeight: '1.55', color: item.color, textAlign: item.align ?? 'left', height: '0px' });
    const ctx = this.measure; ctx.font = textFont(item);
    item.h = Math.max(item.size * 1.55, textLines(item, text => ctx.measureText(text).width).length * item.size * 1.55, this.input.scrollHeight);
    this.input.style.height = `${item.h}px`;
    this.input.scrollTop = 0;
    for (const action of ['bold', 'italic'] as const) this.toolbar.querySelector(`[data-text=${action}]`)!.setAttribute('aria-pressed', String(!!item[action]));
    const size = this.toolbar.querySelector('input')!; if (document.activeElement !== size) size.value = String(item.size);
    this.toolbar.querySelector('select')!.value = item.align ?? 'left';
  }
  private publish() { if (this.draft) this.engine.updateText(this.draft); }
  private ensureCaretVisible() {
    if (!this.draft || !this.input) return;
    const viewport = this.surface.closest<HTMLElement>('.paper-viewport'); if (!viewport) return;
    this.measure.font = textFont(this.draft);
    const prefix = { ...this.draft, text: this.input.value.slice(0, this.input.selectionStart) };
    const row = textLines(prefix, text => this.measure.measureText(text).width).length - 1;
    const height = this.draft.size * 1.55 * this.scale;
    const top = this.input.getBoundingClientRect().top + row * height, rect = viewport.getBoundingClientRect();
    const bottom = Math.min(rect.bottom, this.toolbar.getBoundingClientRect().top - 12);
    if (top + height > bottom) viewport.scrollTop += top + height - bottom + 12;
    else if (top < rect.top + 30) viewport.scrollTop -= rect.top + 30 - top;
  }
  private positionToolbar() {
    const viewport = window.visualViewport;
    this.toolbar.style.bottom = `${Math.max(52, innerHeight - (viewport?.height ?? innerHeight) - (viewport?.offsetTop ?? 0) + 12)}px`;
  }
  private drag(handle: HTMLElement, resize: boolean) {
    let origin: { pointer: number; x: number; y: number; item: TextItem } | undefined;
    handle.addEventListener('pointerdown', event => {
      if (!this.draft) return; event.preventDefault(); event.stopPropagation();
      origin = { pointer: event.pointerId, x: event.clientX, y: event.clientY, item: { ...this.draft } }; handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!origin || !this.draft || origin.pointer !== event.pointerId) return;
      const dx = (event.clientX - origin.x) / this.scale, dy = (event.clientY - origin.y) / this.scale, page = this.engine.page;
      if (resize) this.draft.w = Math.max(100, Math.min(page.width - this.draft.x - 12, origin.item.w + dx));
      else { this.draft.x = Math.max(8, Math.min(page.width - this.draft.w - 8, origin.item.x + dx)); this.draft.y = Math.max(24, Math.min(page.height - 40, origin.item.y + dy)); }
      this.sync();
    });
    const end = () => { if (origin) { origin = undefined; this.publish(); } };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
  finish(cancel = false) {
    if (!this.draft) return;
    // Flush IME text too when navigation/save happens during composition.
    this.draft.text = this.input!.value; this.sync(); if (!cancel) this.publish();
    this.draft = undefined; this.composing = false; this.box?.remove(); this.box = undefined; this.input = undefined; this.toolbar.hidden = true;
    this.engine.finishText(cancel);
  }
  destroy() { this.finish(); this.abort.abort(); this.layer.remove(); this.toolbar.remove(); }
}
