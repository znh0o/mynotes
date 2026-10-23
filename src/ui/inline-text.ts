import { uid, type Point, type TextItem } from '../data/model';
import { InkEngine } from '../engine/InkEngine';
import { documentFrame, splitDocument, textFont, textLines } from '../engine/text';
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
  private mirror = document.createElement('div');
  private carets = new Map<string, number>();
  mode: 'document' | 'box' = 'document';
  private defaults = { size: 22, bold: false, italic: false, align: 'left' as TextItem['align'] };
  constructor(private surface: HTMLElement, shell: HTMLElement, private engine: InkEngine,
    private overflow: (head: TextItem, tail: string) => void, private styleChanged: () => void = () => {}) {
    this.mirror.className = 'text-layout-mirror'; this.mirror.setAttribute('aria-hidden', 'true'); document.body.append(this.mirror);
    this.layer = document.createElement('div'); this.layer.className = 'page-text-layer'; surface.append(this.layer);
    this.toolbar = document.createElement('div'); this.toolbar.className = 'inline-text-toolbar'; this.toolbar.hidden = true;
    this.toolbar.setAttribute('role', 'toolbar'); this.toolbar.setAttribute('aria-label', '글자 서식');
    this.toolbar.innerHTML = `<select id="text-entry-mode" aria-label="입력 방식"><option value="document">본문</option><option value="box">글상자</option></select><label>크기<input type="text" inputmode="numeric" pattern="[0-9]*" role="spinbutton" aria-valuemin="10" aria-valuemax="100" aria-valuenow="22" value="22" aria-label="글자 크기" title="글자 크기 10–100" /></label><button type="button" data-text="bold" aria-label="굵게" aria-pressed="false"><b>B</b></button><button type="button" data-text="italic" aria-label="기울임" aria-pressed="false"><i>I</i></button><select id="text-align" aria-label="글자 정렬"><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select><button type="button" data-text="delete" aria-label="글상자 삭제">${icon('Trash2', 18)}</button><button type="button" data-text="cancel" aria-label="입력 취소">${icon('X', 18)}</button><button type="button" data-text="done" class="text-done">${icon('Check', 18)}<span>입력 완료</span></button>`;
    shell.append(this.toolbar);
    const sizeLabel = this.toolbar.querySelector('label')!;
    sizeLabel.firstChild!.textContent = '글자 크기';
    for (const [action, name, symbol] of [['smaller', '타이핑 글자 작게', '−'], ['larger', '타이핑 글자 크게', '+']] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.text = action;
      button.className = 'text-size-step'; button.setAttribute('aria-label', name); button.title = name; button.textContent = symbol;
      if (action === 'smaller') sizeLabel.insertBefore(button, sizeLabel.querySelector('input'));
      else sizeLabel.append(button);
    }
    const signal = this.abort.signal;
    // Keep the native keyboard/caret when a formatting button is tapped.
    this.toolbar.addEventListener('pointerdown', event => { if ((event.target as Element).closest('button')) event.preventDefault(); }, { signal });
    this.toolbar.addEventListener('click', event => {
      const action = (event.target as Element).closest<HTMLElement>('[data-text]')?.dataset.text;
      if (!action || !this.draft) return;
      if (action === 'done' || action === 'cancel') { this.finish(action === 'cancel'); return; }
      if (action === 'delete') { this.input!.value = ''; this.finish(); return; }
      if (action === 'smaller' || action === 'larger') {
        this.setSize(this.size + (action === 'smaller' ? -1 : 1)); this.focus(); return;
      }
      if (action === 'bold' || action === 'italic') this.draft[action] = !this.draft[action];
      this.sync(); this.publish(); this.input?.focus({ preventScroll: true });
    }, { signal });
    this.toolbar.addEventListener('input', event => {
      if ((event.target as HTMLElement).id === 'text-entry-mode') {
        this.mode = (event.target as HTMLSelectElement).value as typeof this.mode; this.finish();
        if (this.mode === 'document') this.open();
        return;
      }
      if (!this.draft) return;
      const size = Number(this.toolbar.querySelector('input')!.value);
      if (!Number.isFinite(size) || size < 10 || size > 100) return;
      this.draft.align = this.toolbar.querySelector<HTMLSelectElement>('#text-align')!.value as TextItem['align'];
      this.setSize(size);
    }, { signal });
    const sizeInput = this.toolbar.querySelector('input')!;
    sizeInput.addEventListener('focus', () => sizeInput.select(), { signal });
    sizeInput.addEventListener('pointerup', () => requestAnimationFrame(() => { if (document.activeElement === sizeInput) sizeInput.select(); }), { signal });
    sizeInput.addEventListener('change', () => this.setSize(Number(sizeInput.value)), { signal });
    sizeInput.addEventListener('keydown', event => {
      if (['Enter', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); this.setSize(event.key === 'Enter' ? Number(sizeInput.value) : this.size + (event.key === 'ArrowUp' ? 1 : -1));
        if (event.key === 'Enter') this.focus();
      }
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
  get size() { return this.draft?.size ?? this.defaults.size; }
  setSize(value: number) {
    if (!Number.isFinite(value)) return;
    const size = Math.max(10, Math.min(100, Math.round(value)));
    this.defaults.size = size;
    if (this.draft) { this.draft.size = size; this.sync(); this.publish(false); this.ensureCaretVisible(); }
    else this.styleChanged();
  }
  focus() { this.input?.focus({ preventScroll: true }); this.ensureCaretVisible(); }
  setScale(scale: number) {
    this.scale = scale;
    this.layer.style.width = `${this.engine.page.width}px`; this.layer.style.height = `${this.engine.page.height}px`;
    this.layer.style.transform = `scale(${scale})`;
  }
  open(point?: Point, atEnd = false) {
    this.finish();
    const page = this.engine.page;
    const body = this.mode === 'document', frame = documentFrame(page);
    const item = [...page.items].reverse().find((i): i is TextItem => i.kind === 'text' && (body ? i.textMode === 'document' : i.textMode !== 'document' && !!point && point.x >= i.x - 8 && point.x <= i.x + i.w + 8 && point.y >= i.y - 8 && point.y <= i.y + i.h + 8));
    const x = body ? frame.x : item?.x ?? Math.max(16, Math.min(point?.x ?? 64, page.width - 136));
    const y = body ? frame.y : item?.y ?? Math.max(16, Math.min(point?.y ?? 80, page.height - 60));
    const surface = this.surface.getBoundingClientRect(), viewport = this.surface.closest('.paper-viewport')!.getBoundingClientRect();
    const visibleWidth = Math.max(100, (Math.min(surface.right, viewport.right) - surface.left - x * this.scale - 24) / this.scale);
    this.draft = item ? { ...item, wrap: true, w: Math.max(100, Math.min(item.w, page.width - x - 16)) } : { id: uid(), kind: 'text', x, y, w: Math.min(560, visibleWidth, page.width - x - 24), h: 40, text: '', color: this.engine.options.color, wrap: true, ...this.defaults };
    if (body) Object.assign(this.draft, { ...frame, textMode: 'document' });
    this.engine.beginText(this.draft.id);
    this.box = document.createElement('div'); this.box.className = `inline-text-box${body ? ' document-text-box' : ''}`;
    this.box.innerHTML = `${body ? '' : `<button type="button" class="text-move-handle" aria-label="글상자 이동">${icon('Move', 14)}<span>드래그로 이동</span></button>`}<textarea class="inline-text-input" aria-label="페이지에 글 입력" placeholder="${body ? '여기서부터 입력하세요' : '여기에 입력하세요'}" spellcheck="false" enterkeyhint="enter"></textarea>${body ? '' : `<button type="button" class="text-resize-handle" aria-label="글상자 너비 조절">${icon('ChevronRight', 16)}</button>`}`;
    this.layer.append(this.box); this.input = this.box.querySelector('textarea')!; this.input.value = this.draft.text;
    this.input.addEventListener('input', () => { if (this.draft) { this.draft.text = this.input!.value; this.sync(); this.ensureCaretVisible(); if (!this.composing) this.publish(); } });
    this.input.addEventListener('compositionstart', () => this.composing = true);
    this.input.addEventListener('compositionend', () => { this.composing = false; if (this.draft) { this.draft.text = this.input!.value; this.sync(); this.publish(); } });
    this.input.addEventListener('keyup', () => this.ensureCaretVisible());
    if (!body) { this.drag(this.box.querySelector('.text-move-handle')!, false); this.drag(this.box.querySelector('.text-resize-handle')!, true); }
    this.toolbar.hidden = false; this.sync(); this.positionToolbar();
    if (item && point) {
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
    } else {
      const caret = atEnd ? this.input.value.length : Math.min(this.input.value.length, this.carets.get(this.draft.id) ?? 0);
      this.input.setSelectionRange(caret, caret);
    }
    this.input.focus({ preventScroll: true });
    this.ensureCaretVisible();
  }
  setColor(color: string) { if (this.draft) { this.draft.color = color; this.sync(); this.publish(); } }
  private sync() {
    const item = this.draft; if (!item || !this.input || !this.box) return;
    this.defaults = { size: item.size, bold: !!item.bold, italic: !!item.italic, align: item.align ?? 'left' };
    Object.assign(this.box.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.w}px` });
    Object.assign(this.input.style, { fontFamily: '"Segoe UI", "Malgun Gothic", sans-serif', fontSize: `${item.size}px`, fontWeight: item.bold ? '700' : '400', fontStyle: item.italic ? 'italic' : 'normal', lineHeight: '1.55', color: item.color, textAlign: item.align ?? 'left' });
    // Measure in a separate DOM element. Collapsing the focused textarea to
    // zero height makes Android's keyboard/caret scrolling jump the page.
    const layout = this.textLayout();
    item.h = Math.max(item.size * 1.55, layout.height);
    this.input.style.height = `${item.h}px`;
    for (const action of ['bold', 'italic'] as const) this.toolbar.querySelector(`[data-text=${action}]`)!.setAttribute('aria-pressed', String(!!item[action]));
    // Update even while this field is focused. On Android, moving from an
    // edited number to a size button fires change after the button's click;
    // a stale field value would then undo the newly chosen font size.
    const size = this.toolbar.querySelector('input')!; if (size.value !== String(item.size)) size.value = String(item.size);
    size.setAttribute('aria-valuenow', String(item.size));
    this.toolbar.querySelector<HTMLButtonElement>('[data-text=smaller]')!.disabled = item.size <= 10;
    this.toolbar.querySelector<HTMLButtonElement>('[data-text=larger]')!.disabled = item.size >= 100;
    this.toolbar.querySelector<HTMLSelectElement>('#text-align')!.value = item.align ?? 'left';
    this.toolbar.querySelector<HTMLSelectElement>('#text-entry-mode')!.value = this.mode;
    const body = item.textMode === 'document';
    this.toolbar.querySelector('[data-text=delete]')!.setAttribute('aria-label', body ? '본문 지우기' : '글상자 삭제');
    this.styleChanged();
  }
  private textLayout() {
    const item = this.draft!, input = this.input!;
    Object.assign(this.mirror.style, { width: `${item.w}px`, font: textFont(item), lineHeight: '1.55', textAlign: item.align ?? 'left' });
    const caret = input.selectionStart, marker = document.createElement('span'); marker.textContent = '\u200b';
    this.mirror.replaceChildren(document.createTextNode(input.value.slice(0, caret)), marker, document.createTextNode(input.value.slice(caret) + '\u200b'));
    return { height: Math.ceil(this.mirror.getBoundingClientRect().height), top: marker.offsetTop, left: marker.offsetLeft };
  }
  private publish(paginate = true) {
    if (!this.draft) return;
    this.engine.updateText(this.draft);
    if (!paginate || this.composing || this.draft.textMode !== 'document') return;
    this.measure.font = textFont(this.draft);
    const [text, tail] = splitDocument(this.draft, this.engine.page, text => this.measure.measureText(text).width);
    if (!tail) return;
    const head = { ...this.draft, text };
    // The full draft was queued above. Replace it only in the atomic page
    // transaction below, so a failed page insertion cannot lose the overflow.
    this.engine.updateText(head, false); this.close(); this.engine.finishText(false, false); this.overflow(head, tail);
  }
  private ensureCaretVisible() {
    if (!this.draft || !this.input || document.activeElement !== this.input) return;
    const viewport = this.surface.closest<HTMLElement>('.paper-viewport'); if (!viewport) return;
    const layout = this.textLayout();
    const height = this.draft.size * 1.55 * this.scale;
    const top = this.input.getBoundingClientRect().top + layout.top * this.scale, rect = viewport.getBoundingClientRect();
    const bottom = Math.min(rect.bottom, this.toolbar.getBoundingClientRect().top - 12);
    if (top + height > bottom) viewport.scrollTop += top + height - bottom + 12;
    else if (top < rect.top + 30) viewport.scrollTop -= rect.top + 30 - top;
    const left = this.input.getBoundingClientRect().left + layout.left * this.scale;
    if (left < rect.left + 16) viewport.scrollLeft -= rect.left + 16 - left;
    else if (left > rect.right - 16) viewport.scrollLeft += left - rect.right + 16;
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
    this.close();
    this.engine.finishText(cancel);
  }
  private close() {
    if (this.draft && this.input) this.carets.set(this.draft.id, this.input.selectionStart);
    this.draft = undefined; this.composing = false; this.box?.remove(); this.box = undefined; this.input = undefined; this.toolbar.hidden = true;
  }
  destroy() { this.finish(); this.abort.abort(); this.layer.remove(); this.toolbar.remove(); this.mirror.remove(); }
}
