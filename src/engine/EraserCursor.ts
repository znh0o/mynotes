import type { Tool } from '../data/model';
import { penEraser } from './pen-input';

interface CursorState { pageWidth?: number; tool: Tool; size: number; activePointer: number | null; rect?: DOMRect }
type Position = Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType' | 'pointerId' | 'buttons'>;

// A DOM overlay stays out of saved ink, thumbnails and PDF output. Moving it
// never clears/replays either ink canvas.
export class EraserCursor {
  private circle = document.createElement('div');
  private position?: Position;
  private previewTimer?: ReturnType<typeof setTimeout>;
  constructor(private canvas: HTMLCanvasElement, private state: () => CursorState, signal: AbortSignal) {
    this.circle.className = 'eraser-cursor'; this.circle.hidden = true; this.circle.setAttribute('aria-hidden', 'true');
    canvas.parentElement!.append(this.circle);
    const options = { signal };
    for (const type of ['pointerenter', 'pointerdown', 'pointermove'] as const) canvas.addEventListener(type, event => {
      clearTimeout(this.previewTimer); this.position = event; this.refresh();
    }, options);
    canvas.addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') this.clear();
      else { this.position = event; this.refresh(); }
    }, options);
    canvas.addEventListener('pointerleave', () => this.clear(), options);
    canvas.addEventListener('pointercancel', () => this.clear(), options);
    canvas.closest('.paper-viewport')?.addEventListener('scroll', () => this.clear(), options);
    window.addEventListener('blur', () => this.clear(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); }, options);
  }
  private hide() { if (this.circle.hidden) return; this.circle.hidden = true; this.canvas.classList.remove('eraser-cursor-active'); }
  clear() { clearTimeout(this.previewTimer); this.position = undefined; this.hide(); }
  refresh() {
    const state = this.state(), position = this.position;
    if (!position || !state.pageWidth || state.tool !== 'eraser' && !penEraser(position)
      || position.pointerType === 'touch' && state.activePointer !== position.pointerId) { this.hide(); return; }
    this.paint(position, state);
  }
  private paint(position: Pick<Position, 'clientX' | 'clientY'>, state: CursorState) {
    const rect = state.rect ?? this.canvas.getBoundingClientRect();
    if (!rect.width || !state.pageWidth || position.clientX < rect.left || position.clientX > rect.right || position.clientY < rect.top || position.clientY > rect.bottom) { this.hide(); return; }
    const size = state.size * rect.width / state.pageWidth;
    this.circle.style.width = this.circle.style.height = `${size}px`;
    this.circle.style.transform = `translate3d(${position.clientX - rect.left - size / 2}px, ${position.clientY - rect.top - size / 2}px, 0)`;
    this.circle.hidden = false; this.canvas.classList.add('eraser-cursor-active');
  }
  previewSize() {
    const state = this.state(); if (state.tool !== 'eraser' || !state.pageWidth) return;
    clearTimeout(this.previewTimer);
    if (this.position) this.refresh();
    else {
      const rect = this.canvas.getBoundingClientRect(), viewport = this.canvas.closest('.paper-viewport')!.getBoundingClientRect();
      const left = Math.max(rect.left, viewport.left), right = Math.min(rect.right, viewport.right);
      const top = Math.max(rect.top, viewport.top), bottom = Math.min(rect.bottom, viewport.bottom);
      if (right <= left || bottom <= top) return;
      this.paint({ clientX: (left + right) / 2, clientY: (top + bottom) / 2 }, state);
    }
    this.previewTimer = setTimeout(() => { if (!this.position) this.hide(); }, 1200);
  }
  destroy() { this.clear(); this.circle.remove(); }
}
