import { uid, type Item, type Page, type Point, type Shape, type ShapeItem, type Stroke, type Tool } from '../data/model';
import { bounds, erase, inside, transform } from './geometry';
import { drawItem, drawItems } from './render';

export interface InkOptions {
  tool: Tool; color: string; width: number; pressure: boolean; fingerDrawing: boolean;
  eraserSize: number; partialEraser: boolean; shape: Shape;
}
export class InkEngine {
  options: InkOptions = { tool: 'pen', color: '#30445e', width: 3, pressure: true, fingerDrawing: false, eraserSize: 24, partialEraser: false, shape: 'rect' };
  page!: Page;
  selected = new Set<string>();
  activePointer: number | null = null;
  lastPen = 0;
  private stroke: Stroke | null = null;
  private shape: ShapeItem | null = null;
  private lasso: Point[] = [];
  private last: Point | null = null;
  private start: Point | null = null;
  private before: Item[] | null = null;
  private moving = false;
  private frame = 0;
  private ratio = 1;
  private dirtyInk = false;
  private history: Item[][] = [];
  private future: Item[][] = [];
  private clipboard: Item[] = [];
  private abort = new AbortController();
  constructor(private ink: HTMLCanvasElement, private live: HTMLCanvasElement,
    private changed: () => void, private selection: (count: number) => void,
    private insert: (point: Point, tool: Tool) => void) {
    const options = { signal: this.abort.signal };
    live.addEventListener('pointerdown', e => this.down(e), options);
    live.addEventListener('pointermove', e => this.move(e), options);
    live.addEventListener('pointerup', e => this.up(e), options);
    live.addEventListener('pointercancel', e => { if (e.pointerId === this.activePointer) this.cancel(); }, options);
    live.addEventListener('lostpointercapture', e => { if (e.pointerId === this.activePointer) this.cancel(); }, options);
    live.addEventListener('contextmenu', e => e.preventDefault(), options);
  }
  load(page: Page) {
    this.cancel(); this.page = page; this.selected.clear(); this.selection(0);
    this.history = []; this.future = []; this.resize();
  }
  resize() {
    if (!this.page) return;
    const rect = this.live.getBoundingClientRect();
    const target = Math.max(1, (rect.width / this.page.width) * devicePixelRatio);
    this.ratio = Math.min(target, Math.sqrt(14000000 / (this.page.width * this.page.height)));
    for (const canvas of [this.ink, this.live]) {
      canvas.width = Math.ceil(this.page.width * this.ratio); canvas.height = Math.ceil(this.page.height * this.ratio);
    }
    this.render(); this.preview();
  }
  point(e: PointerEvent): Point {
    const r = this.live.getBoundingClientRect();
    return { x: (e.clientX - r.left) * this.page.width / r.width,
      y: (e.clientY - r.top) * this.page.height / r.height,
      p: e.pointerType === 'pen' ? Math.max(.05, e.pressure || .05) : .65, t: e.timeStamp };
  }
  private context(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0); return ctx;
  }
  render() { if (this.page) drawItems(this.context(this.ink), this.page.items); }
  private preview() {
    const ctx = this.context(this.live);
    if (this.stroke) drawItem(ctx, this.stroke);
    if (this.shape) drawItem(ctx, this.shape);
    ctx.strokeStyle = '#5d8ac2'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    if (this.lasso.length) { ctx.beginPath(); this.lasso.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fillStyle = '#719ad417'; ctx.fill(); ctx.stroke(); }
    if (this.selected.size) {
      const b = bounds(this.page.items.filter(i => this.selected.has(i.id)));
      ctx.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
      ctx.setLineDash([]); ctx.fillStyle = '#fff';
      for (const p of [{ x: b.x - 8, y: b.y - 8 }, { x: b.x + b.w + 8, y: b.y + b.h + 8 }]) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
  }
  private schedule() { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; if (this.dirtyInk) { this.dirtyInk = false; this.render(); } this.preview(); }); }
  private checkpoint() { this.before = structuredClone(this.page.items); }
  private commit() {
    if (!this.before) return;
    this.history.push(this.before); if (this.history.length > 40) this.history.shift();
    this.future = []; this.before = null; this.page.revision++; this.changed();
  }
  mutate(fn: () => void) { this.checkpoint(); fn(); this.commit(); this.render(); this.preview(); }
  undo() {
    if (this.activePointer !== null) this.cancel();
    const previous = this.history.pop(); if (!previous) return;
    this.future.push(structuredClone(this.page.items)); this.page.items = previous; this.clearSelection();
    this.page.revision++; this.render(); this.changed();
  }
  redo() {
    const next = this.future.pop(); if (!next) return;
    this.history.push(structuredClone(this.page.items)); this.page.items = next; this.clearSelection();
    this.page.revision++; this.render(); this.changed();
  }
  get canUndo() { return !!this.history.length; }
  get canRedo() { return !!this.future.length; }
  clearSelection() { this.selected.clear(); this.selection(0); this.preview(); }
  selectionAction(action: string) {
    const items = this.page.items.filter(i => this.selected.has(i.id));
    if (action === 'copy') { this.clipboard = structuredClone(items); return; }
    if (action === 'paste') {
      if (!this.clipboard.length) return;
      this.mutate(() => { const copies = structuredClone(this.clipboard); copies.forEach(i => i.id = uid()); transform(copies, 24, 24); this.page.items.push(...copies); this.selected = new Set(copies.map(i => i.id)); });
    } else if (items.length) {
      this.mutate(() => {
        if (action === 'delete') { this.page.items = this.page.items.filter(i => !this.selected.has(i.id)); this.selected.clear(); }
        else transform(items, 0, 0, action === 'grow' ? 1.15 : 1 / 1.15);
      });
    }
    this.selection(this.selected.size);
  }
  cancel() {
    if (this.before && this.page) { this.page.items = this.before; this.before = null; this.render(); }
    this.stroke = null; this.shape = null; this.lasso = []; this.activePointer = null; this.moving = false;
    if (this.page) this.preview();
  }
  private down(e: PointerEvent) {
    if (!this.page || this.activePointer !== null || e.button > 0 && e.button !== 5) return;
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    if (e.pointerType === 'touch' && (!this.options.fingerDrawing || performance.now() - this.lastPen < 800)) return;
    if (this.options.tool === 'hand') return;
    e.preventDefault();
    const p = this.point(e), tool = e.button === 5 || e.buttons === 32 ? 'eraser' : this.options.tool;
    if (tool === 'text' || tool === 'image') { this.insert(p, tool); return; }
    this.activePointer = e.pointerId; this.live.setPointerCapture(e.pointerId); this.start = this.last = p;
    this.checkpoint();
    if (tool === 'lasso') {
      const b = bounds(this.page.items.filter(i => this.selected.has(i.id)));
      if (this.selected.size && p.x >= b.x - 12 && p.x <= b.x + b.w + 12 && p.y >= b.y - 12 && p.y <= b.y + b.h + 12) this.moving = true;
      else { this.clearSelection(); this.lasso = [p]; }
    } else if (tool === 'eraser') {
      this.page.items = erase(this.page.items, p, p, this.options.eraserSize / 2, this.options.partialEraser); this.render();
    } else if (tool === 'shape') this.shape = { id: uid(), kind: 'shape', shape: this.options.shape, x: p.x, y: p.y, w: 0, h: 0, color: this.options.color, width: this.options.width };
    else this.stroke = { id: uid(), kind: 'stroke', tool: tool as Stroke['tool'], color: this.options.color,
      width: tool === 'highlighter' ? Math.max(14, this.options.width * 5) : this.options.width,
      pressure: tool === 'fountain' || this.options.pressure, points: [p] };
    this.schedule();
  }
  private move(e: PointerEvent) {
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    if (e.pointerId !== this.activePointer || !this.last) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const event of events.length ? events : [e]) {
      const p = this.point(event);
      if (this.stroke) {
        const previous = this.stroke.points[this.stroke.points.length - 1];
        if (Math.hypot(p.x - previous.x, p.y - previous.y) > .35) this.stroke.points.push({ ...p, p: previous.p * .25 + p.p * .75 });
      } else if (this.shape && this.start) { this.shape.w = p.x - this.start.x; this.shape.h = p.y - this.start.y; }
      else if (this.moving) { transform(this.page.items.filter(i => this.selected.has(i.id)), p.x - this.last.x, p.y - this.last.y); this.dirtyInk = true; }
      else if (this.lasso.length) this.lasso.push(p);
      else { this.page.items = erase(this.page.items, this.last, p, this.options.eraserSize / 2, this.options.partialEraser); this.dirtyInk = true; }
      this.last = p;
    }
    this.schedule();
  }
  private up(e: PointerEvent) {
    if (e.pointerId !== this.activePointer) return;
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    if (this.stroke) this.page.items.push(this.stroke);
    if (this.shape && Math.abs(this.shape.w) + Math.abs(this.shape.h) > 2) this.page.items.push(this.shape);
    if (this.lasso.length) {
      const polygon = this.lasso;
      for (const item of this.page.items) {
        const b = bounds([item]);
        if (item.kind === 'stroke' ? item.points.some(p => inside(p, polygon)) : inside({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, polygon)) this.selected.add(item.id);
      }
      this.before = null; this.selection(this.selected.size);
    } else this.commit();
    this.stroke = null; this.shape = null; this.lasso = []; this.moving = false;
    this.activePointer = null; this.render(); this.preview();
    if (this.live.hasPointerCapture(e.pointerId)) this.live.releasePointerCapture(e.pointerId);
  }
  destroy() { this.cancel(); this.abort.abort(); cancelAnimationFrame(this.frame); }
}
