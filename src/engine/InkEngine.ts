import { uid, type ImageItem, type Item, type Page, type Point, type Shape, type ShapeItem, type Stroke, type TextItem, type Tool } from '../data/model';
import { bounds, erase, inside, transform } from './geometry';
import { drawItem, drawItems } from './render';
import { LiveStroke } from './LiveStroke';
import { canStraighten, straightPoints } from './straight-line';
import { penContact, penEraser, SamsungPenToggle } from './pen-input';
import { EraserCursor } from './EraserCursor';
import { PalmRejection } from './PalmRejection';

export interface InkOptions {
  tool: Tool; color: string; width: number; fingerDrawing: boolean;
  eraserSize: number; partialEraser: boolean; shape: Shape; pencilDarkness: number; holdToLine: boolean; samsungButtonToggle: boolean;
}
export class InkEngine {
  options: InkOptions = { tool: 'pen', color: '#30445e', width: 3, fingerDrawing: false, eraserSize: 24, partialEraser: false, shape: 'rect', pencilDarkness: .7, holdToLine: true, samsungButtonToggle: false };
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
  private imageGesture?: { original: ImageItem; start: Point; corner?: { x: number; y: number } };
  private gestureTool: Tool | null = null;
  private frame = 0;
  private ratio = 1;
  private pixelSize?: { cssWidth: number; deviceWidth: number };
  private pixelObserver: ResizeObserver;
  private dirtyInk = false;
  private history: Item[][] = [];
  private future: Item[][] = [];
  private clipboard: Item[] = [];
  private abort = new AbortController();
  private liveStroke = new LiveStroke();
  private inputRect?: DOMRect;
  private holdTimer?: ReturnType<typeof setTimeout>;
  private holdAnchor?: Point;
  private straightSource?: Point[];
  private textSession?: { id: string; before: Item[] };
  private eraserCursor: EraserCursor;
  private samsungButton = new SamsungPenToggle();
  private sharpPreview?: (item: Stroke | ShapeItem | null, recompute?: boolean) => void;
  private palmGuard?: PalmRejection;
  private outsidePens = new Set<number>();
  constructor(private ink: HTMLCanvasElement, private live: HTMLCanvasElement,
    private changed: () => void, private selection: (count: number) => void,
    private insert: (point: Point, tool: Tool) => void, private straightened: () => void = () => {},
    private toggleEraser: () => void = () => {}) {
    const options = { signal: this.abort.signal };
    document.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'pen') return;
      if (e.target === live) this.outsidePens.delete(e.pointerId);
      else this.outsidePens.add(e.pointerId);
    }, { ...options, capture: true });
    const releaseOutside = (e: PointerEvent) => { if (e.pointerType === 'pen') this.outsidePens.delete(e.pointerId); };
    document.addEventListener('pointerup', releaseOutside, { ...options, capture: true });
    document.addEventListener('pointercancel', releaseOutside, { ...options, capture: true });
    document.addEventListener('pointermove', e => { if (e.pointerType === 'pen' && !penContact(e)) releaseOutside(e); }, { ...options, capture: true });
    const button = (e: PointerEvent) => {
      if (!this.samsungButton.update(e, this.options.samsungButtonToggle, this.activePointer !== null)) return false;
      this.lastPen = performance.now(); e.preventDefault(); this.toggleEraser(); return true;
    };
    live.addEventListener('pointerdown', e => { this.palmGuard?.notePen(e); if (!button(e)) this.down(e); }, options);
    live.addEventListener('pointermove', e => { this.palmGuard?.notePen(e); if (!button(e)) this.move(e); }, options);
    live.addEventListener('pointerup', e => { this.palmGuard?.notePen(e); button(e); this.up(e); }, options);
    live.addEventListener('pointercancel', e => { this.palmGuard?.notePen(e); button(e); if (e.pointerId === this.activePointer) this.cancel(); }, options);
    live.addEventListener('pointerleave', e => { this.palmGuard?.notePen(e); button(e); }, options);
    live.addEventListener('lostpointercapture', e => { if (e.pointerType === 'pen') this.palmGuard?.endPen(e.pointerId); if (e.pointerId === this.activePointer) this.cancel(); }, options);
    live.addEventListener('contextmenu', e => e.preventDefault(), options);
    this.eraserCursor = new EraserCursor(live, () => ({ pageWidth: this.page?.width, tool: this.options.tool,
      size: this.options.eraserSize, activePointer: this.activePointer, rect: this.inputRect }), this.abort.signal);
    this.pixelObserver = new ResizeObserver(entries => {
      const entry = entries[0], deviceWidth = entry?.devicePixelContentBoxSize?.[0]?.inlineSize;
      if (!deviceWidth) return;
      const cssWidth = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      if (this.pixelSize?.cssWidth === cssWidth && this.pixelSize.deviceWidth === deviceWidth) return;
      this.pixelSize = { cssWidth, deviceWidth };
      if (this.page && !this.live.closest('.zoom-preview')) this.resize();
    });
    try { this.pixelObserver.observe(live, { box: 'device-pixel-content-box' }); }
    catch { this.pixelObserver.observe(live); }
    window.addEventListener('blur', () => { this.samsungButton.reset(); this.outsidePens.clear(); this.palmGuard?.resetActive(); if (this.activePointer !== null) this.cancel(); }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.samsungButton.reset(); }, options);
  }
  load(page: Page) {
    this.samsungButton.reset(); this.cancel(); this.page = page; this.selected.clear(); this.selection(0);
    this.history = []; this.future = []; this.resize(true);
  }
  setSharpPreview(draw: (item: Stroke | ShapeItem | null, recompute?: boolean) => void) { this.sharpPreview = draw; }
  setPalmGuard(guard: PalmRejection) { this.palmGuard = guard; }
  resize(force = false) {
    if (!this.page) return;
    this.inputRect = undefined;
    const rect = this.live.getBoundingClientRect();
    const physicalWidth = this.pixelSize && Math.abs(this.pixelSize.cssWidth - rect.width) < 1
      ? Math.max(this.pixelSize.deviceWidth, rect.width * devicePixelRatio) : rect.width * devicePixelRatio;
    const target = Math.max(1, physicalWidth / this.page.width);
    // Keep ink at native display density on large tablets when possible.
    // The pixel cap still bounds the two canvas layers (and the second page).
    const ratio = Math.min(target, Math.sqrt(18000000 / (this.page.width * this.page.height)));
    const width = Math.ceil(this.page.width * ratio), height = Math.ceil(this.page.height * ratio);
    if (!force && this.ink.width === width && this.ink.height === height && this.live.width === width && this.live.height === height) return;
    this.ratio = ratio;
    for (const canvas of [this.ink, this.live]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    this.liveStroke.reset(); this.sharpPreview?.(null); this.render(); this.preview();
  }
  point(e: PointerEvent): Point {
    const r = this.inputRect ?? this.live.getBoundingClientRect();
    return { x: (e.clientX - r.left) * this.page.width / r.width,
      y: (e.clientY - r.top) * this.page.height / r.height,
      p: e.pointerType === 'pen' ? Math.max(.05, e.pressure || .05) : .65, t: e.timeStamp };
  }
  private context(canvas: HTMLCanvasElement, clear = true) {
    const ctx = canvas.getContext('2d')!; ctx.setTransform(1, 0, 0, 1, 0, 0); if (clear) ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0); return ctx;
  }
  render() { if (this.page) drawItems(this.context(this.ink), this.textSession ? this.page.items.filter(i => i.id !== this.textSession!.id) : this.page.items); }
  private preview() {
    if (this.stroke && !this.straightSource && this.liveStroke.draw(this.context(this.live, false), this.stroke, this.ratio)) {
      this.sharpPreview?.(this.stroke); return;
    }
    this.liveStroke.reset();
    const ctx = this.context(this.live);
    if (this.stroke) drawItem(ctx, this.stroke);
    if (this.shape) drawItem(ctx, this.shape);
    ctx.save();
    ctx.strokeStyle = '#5d8ac2'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    if (this.lasso.length) { ctx.beginPath(); this.lasso.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fillStyle = '#719ad417'; ctx.fill(); ctx.stroke(); }
    if (this.selected.size) {
      const items = this.page.items.filter(i => this.selected.has(i.id));
      const b = bounds(items), image = this.options.tool === 'image' && items.length === 1 && items[0].kind === 'image';
      const screenScale = this.live.getBoundingClientRect().width / this.page.width;
      const pad = image ? 0 : 8, radius = image ? 5 / screenScale : 4;
      if (image) { ctx.setLineDash([]); ctx.lineWidth = 1.5 / screenScale; }
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.setLineDash([]); ctx.fillStyle = '#fff';
      const corners = image ? this.imageCorners(b) : [{ x: b.x - 8, y: b.y - 8 }, { x: b.x + b.w + 8, y: b.y + b.h + 8 }];
      for (const p of corners) { ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    ctx.restore();
    this.sharpPreview?.(this.stroke ?? this.shape, !!this.straightSource);
  }
  private schedule() { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; if (this.dirtyInk) { this.dirtyInk = false; this.render(); } this.preview(); }); }
  private checkpoint() { this.before = this.page.items.slice(); }
  private mutableSelection() {
    this.page.items = this.page.items.map(item => this.selected.has(item.id) ? structuredClone(item) : item);
    return this.page.items.filter(item => this.selected.has(item.id));
  }
  private commit() {
    if (!this.before) return;
    this.history.push(this.before); if (this.history.length > 40) this.history.shift();
    this.future = []; this.before = null; this.page.revision++; this.changed();
  }
  mutate(fn: () => void) { this.checkpoint(); fn(); this.commit(); this.render(); this.preview(); }
  beginText(id: string) {
    this.cancel(); this.clearSelection();
    this.textSession = { id, before: this.page.items.slice() }; this.render();
  }
  updateText(item: TextItem, notify = true) {
    if (this.textSession?.id !== item.id) return;
    const index = this.page.items.findIndex(i => i.id === item.id);
    const items = this.page.items.filter(i => i.id !== item.id);
    if (item.textMode === 'document' ? item.text.length : item.text.trim()) items.splice(index < 0 ? items.length : index, 0, { ...item });
    this.page.items = items; this.page.revision++; if (notify) this.changed();
  }
  finishText(cancel = false, notify = true) {
    const session = this.textSession; if (!session) return;
    this.textSession = undefined;
    if (cancel) this.page.items = session.before;
    else if (JSON.stringify(session.before.find(i => i.id === session.id)) !== JSON.stringify(this.page.items.find(i => i.id === session.id))) {
      this.history.push(session.before); if (this.history.length > 40) this.history.shift(); this.future = [];
    }
    this.page.revision++; this.render(); if (notify) this.changed();
  }
  undo() {
    if (this.activePointer !== null) this.cancel();
    const previous = this.history.pop(); if (!previous) return;
    this.future.push(this.page.items); this.page.items = previous; this.clearSelection();
    this.page.revision++; this.render(); this.changed();
  }
  redo() {
    const next = this.future.pop(); if (!next) return;
    this.history.push(this.page.items); this.page.items = next; this.clearSelection();
    this.page.revision++; this.render(); this.changed();
  }
  get canUndo() { return !!this.history.length; }
  get canRedo() { return !!this.future.length; }
  clearSelection() { this.selected.clear(); this.selection(0); this.preview(); }
  selectImage(id: string) {
    this.selected = new Set([id]); this.selection(1); this.preview();
  }
  private imageCorners(b: { x: number; y: number; w: number; h: number }) {
    return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  }
  private beginImage(e: PointerEvent, p: Point) {
    const selected = this.page.items.find((item): item is ImageItem => item.kind === 'image' && this.selected.has(item.id));
    const hitRadius = (e.pointerType === 'touch' ? 20 : 13) * this.page.width / this.inputRect!.width;
    const corner = selected && this.imageCorners(selected).find(c => Math.hypot(c.x - p.x, c.y - p.y) <= hitRadius);
    const item = corner ? selected : [...this.page.items].reverse().find((item): item is ImageItem => item.kind === 'image'
      && p.x >= item.x && p.x <= item.x + item.w && p.y >= item.y && p.y <= item.y + item.h);
    if (!item) { this.clearSelection(); this.inputRect = undefined; return; }
    this.selectImage(item.id); this.checkpoint(); this.mutableSelection();
    this.imageGesture = { original: { ...item }, start: p, corner: corner ? { x: corner.x === item.x ? -1 : 1, y: corner.y === item.y ? -1 : 1 } : undefined };
    this.activePointer = e.pointerId; this.live.setPointerCapture(e.pointerId);
    this.start = this.last = p; this.gestureTool = 'image';
  }
  private moveImage(p: Point) {
    const { original: source, start, corner } = this.imageGesture!;
    const item = this.page.items.find((item): item is ImageItem => item.id === source.id && item.kind === 'image')!;
    const dx = p.x - start.x, dy = p.y - start.y;
    if (!corner) {
      item.x = Math.max(0, Math.min(this.page.width - source.w, source.x + dx));
      item.y = Math.max(0, Math.min(this.page.height - source.h, source.y + dy));
    } else {
      const anchorX = source.x + (corner.x < 0 ? source.w : 0), anchorY = source.y + (corner.y < 0 ? source.h : 0);
      const max = Math.min((corner.x < 0 ? anchorX : this.page.width - anchorX) / source.w,
        (corner.y < 0 ? anchorY : this.page.height - anchorY) / source.h);
      const min = Math.min(1, 24 / Math.min(source.w, source.h));
      const scale = Math.max(Math.min(min, max), Math.min(max, 1 + (dx * corner.x * source.w + dy * corner.y * source.h) / (source.w ** 2 + source.h ** 2)));
      item.w = source.w * scale; item.h = source.h * scale;
      item.x = anchorX - (corner.x < 0 ? item.w : 0); item.y = anchorY - (corner.y < 0 ? item.h : 0);
    }
    this.dirtyInk = true;
  }
  selectionAction(action: string) {
    const items = this.page.items.filter(i => this.selected.has(i.id));
    if (action === 'copy') { this.clipboard = structuredClone(items); return; }
    if (action === 'paste' || action === 'duplicate') {
      const source = action === 'paste' ? this.clipboard : items;
      if (!source.length) return;
      this.mutate(() => {
        const copies = structuredClone(source);
        copies.forEach(i => i.id = uid());
        const box = bounds(copies);
        const offset = (start: number, end: number, limit: number) => end + 24 <= limit ? 24 : start >= 24 ? -24 : 0;
        transform(copies, offset(box.x, box.x + box.w, this.page.width), offset(box.y, box.y + box.h, this.page.height));
        this.page.items.push(...copies); this.selected = new Set(copies.map(i => i.id));
      });
    } else if (items.length) {
      this.mutate(() => {
        if (action === 'delete') { this.page.items = this.page.items.filter(i => !this.selected.has(i.id)); this.selected.clear(); }
        else transform(this.mutableSelection(), 0, 0, action === 'grow' ? 1.15 : 1 / 1.15);
      });
    }
    this.selection(this.selected.size);
  }
  cancel() {
    this.eraserCursor.clear();
    clearTimeout(this.holdTimer); this.holdTimer = undefined; this.holdAnchor = undefined; this.straightSource = undefined;
    if (this.before && this.page) { this.page.items = this.before; this.before = null; this.render(); }
    this.stroke = null; this.shape = null; this.lasso = []; this.activePointer = null; this.moving = false; this.imageGesture = undefined; this.gestureTool = null; this.inputRect = undefined;
    this.liveStroke.reset(); this.dirtyInk = false;
    if (this.page) this.preview();
  }
  private down(e: PointerEvent) {
    if (!this.page || this.activePointer !== null) return;
    if (e.pointerType === 'pen' && this.outsidePens.has(e.pointerId)) return;
    if (e.pointerType === 'pen' ? !penContact(e) : e.button !== 0) return;
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    if (e.pointerType === 'touch' && (this.palmGuard?.rejectTouch(e) ||
      !['text', 'image'].includes(this.options.tool) && !this.options.fingerDrawing)) return;
    const tool = penEraser(e) ? 'eraser' : this.options.tool;
    if (tool === 'hand') return;
    e.preventDefault();
    this.inputRect = this.live.getBoundingClientRect();
    const p = this.point(e);
    if (tool === 'image') { this.beginImage(e, p); return; }
    if (tool === 'text') { this.inputRect = undefined; this.insert(p, tool); return; }
    this.activePointer = e.pointerId; this.live.setPointerCapture(e.pointerId); this.start = this.last = p;
    this.checkpoint();
    this.beginSegment(tool, p); this.armStraightLine(p); this.schedule();
  }
  private beginSegment(tool: Tool, p: Point) {
    this.gestureTool = tool;
    if (tool === 'lasso') {
      const b = bounds(this.page.items.filter(i => this.selected.has(i.id)));
      if (this.selected.size && p.x >= b.x - 12 && p.x <= b.x + b.w + 12 && p.y >= b.y - 12 && p.y <= b.y + b.h + 12) { this.mutableSelection(); this.moving = true; }
      else { this.clearSelection(); this.lasso = [p]; }
    } else if (tool === 'eraser') {
      this.page.items = erase(this.page.items, p, p, this.options.eraserSize / 2, this.options.partialEraser); this.dirtyInk = true;
    } else if (tool === 'shape') this.shape = { id: uid(), kind: 'shape', shape: this.options.shape, x: p.x, y: p.y, w: 0, h: 0, color: this.options.color, width: this.options.width };
    else if (['pen', 'fountain', 'pencil', 'highlighter'].includes(tool)) this.stroke = { id: uid(), kind: 'stroke', tool: tool as Stroke['tool'], color: this.options.color,
      width: this.options.width,
      pressure: tool === 'fountain', brushVersion: 2,
      ...(tool === 'pencil' ? { textureSeed: Math.floor(Math.random() * 0x100000000), pencilDarkness: this.options.pencilDarkness } : {}), points: [p] };
  }
  private switchSegment(tool: Tool, p: Point) {
    // Settle the ink before erasing it. Keep one undo snapshot for this contact,
    // and begin a fresh stroke on release instead of bridging the erased path.
    if (this.stroke) this.page.items.push(this.stroke);
    if (this.shape && Math.abs(this.shape.w) + Math.abs(this.shape.h) > 2) this.page.items.push(this.shape);
    clearTimeout(this.holdTimer); this.holdTimer = undefined; this.holdAnchor = undefined; this.straightSource = undefined;
    this.stroke = null; this.shape = null; this.lasso = []; this.moving = false;
    this.liveStroke.reset(); this.context(this.live); this.start = this.last = p;
    this.beginSegment(tool, p); this.dirtyInk = true;
  }
  private armStraightLine(point: Point) {
    if (!this.stroke || !this.options.holdToLine || this.straightSource) return;
    const tolerance = 3 * this.page.width / (this.inputRect?.width || this.page.width);
    if (this.holdAnchor && Math.hypot(point.x - this.holdAnchor.x, point.y - this.holdAnchor.y) <= tolerance) return;
    this.holdAnchor = point; clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = undefined;
      if (!this.stroke || this.activePointer === null || !this.options.holdToLine || !canStraighten(this.stroke.points)) return;
      this.straightSource = this.stroke.points;
      this.stroke.points = straightPoints(this.straightSource, this.last!);
      this.liveStroke.reset(); this.preview(); this.straightened();
    }, 600);
  }
  private move(e: PointerEvent) {
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    // With a barrel held in the air, tip contact/lift arrives as pointermove,
    // rather than another pointerdown/up (chorded Pointer Events).
    if (e.pointerType === 'pen' && this.activePointer === null && penContact(e)) { this.down(e); return; }
    if (e.pointerId !== this.activePointer || !this.last) return;
    e.preventDefault();
    if (this.imageGesture) {
      if (e.pointerType === 'pen' && !penContact(e)) { this.up(e); return; }
      this.moveImage(this.point(e)); this.schedule(); return;
    }
    let switched = false;
    if (e.pointerType === 'pen') {
      if (!penContact(e)) { this.up(e); return; }
      const tool = penEraser(e) ? 'eraser' : this.options.tool;
      if (tool !== this.gestureTool) { this.switchSegment(tool, this.point(e)); switched = true; }
    }
    // Coalesced positions precede a button transition; never replay them with
    // the new tool, which would draw back across a freshly erased segment.
    const events = !switched && typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const event of events.length ? events : [e]) {
      if (e.pointerType === 'pen' && !penContact(event)) continue;
      const p = this.point(event);
      if (this.stroke) {
        if (this.straightSource) this.stroke.points = straightPoints(this.straightSource, p);
        else {
          const previous = this.stroke.points[this.stroke.points.length - 1];
          if (Math.hypot(p.x - previous.x, p.y - previous.y) > .35) this.stroke.points.push({ ...p, p: previous.p * .25 + p.p * .75 });
          this.armStraightLine(p);
        }
      } else if (this.shape && this.start) { this.shape.w = p.x - this.start.x; this.shape.h = p.y - this.start.y; }
      else if (this.moving) { transform(this.page.items.filter(i => this.selected.has(i.id)), p.x - this.last.x, p.y - this.last.y); this.dirtyInk = true; }
      else if (this.lasso.length) this.lasso.push(p);
      else if (this.gestureTool === 'eraser') { this.page.items = erase(this.page.items, this.last, p, this.options.eraserSize / 2, this.options.partialEraser); this.dirtyInk = true; }
      this.last = p;
    }
    this.schedule();
  }
  private up(e: PointerEvent) {
    if (e.pointerId !== this.activePointer) return;
    clearTimeout(this.holdTimer); this.holdTimer = undefined; this.holdAnchor = undefined;
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    cancelAnimationFrame(this.frame); this.frame = 0;
    if (this.dirtyInk) { this.render(); this.dirtyInk = false; }
    if (this.stroke) {
      this.preview();
      const ctx = this.context(this.ink, false);
      if (this.liveStroke.commit(this.stroke)) {
        ctx.save(); ctx.resetTransform(); ctx.drawImage(this.live, 0, 0); ctx.restore();
      } else drawItem(ctx, this.stroke);
    } else if (this.shape && Math.abs(this.shape.w) + Math.abs(this.shape.h) > 2) drawItem(this.context(this.ink, false), this.shape);
    else this.render();
    if (this.stroke) this.page.items.push(this.stroke);
    if (this.shape && Math.abs(this.shape.w) + Math.abs(this.shape.h) > 2) this.page.items.push(this.shape);
    if (this.imageGesture) {
      const source = this.imageGesture.original, item = this.page.items.find(i => i.id === source.id) as ImageItem;
      if (item.x === source.x && item.y === source.y && item.w === source.w && item.h === source.h) this.before = null;
    }
    if (this.lasso.length) {
      const polygon = this.lasso;
      for (const item of this.page.items) {
        if (item.kind === 'text' && item.textMode === 'document') continue;
        const b = bounds([item]);
        if (item.kind === 'stroke' ? item.points.some(p => inside(p, polygon)) : inside({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, polygon)) this.selected.add(item.id);
      }
      this.before = null; this.selection(this.selected.size);
    } else this.commit();
    this.stroke = null; this.shape = null; this.lasso = []; this.moving = false; this.imageGesture = undefined; this.straightSource = undefined;
    this.activePointer = null; this.gestureTool = null; this.inputRect = undefined; this.dirtyInk = false; this.preview();
    if (this.live.hasPointerCapture(e.pointerId)) this.live.releasePointerCapture(e.pointerId);
  }
  previewEraserSize() { this.eraserCursor.previewSize(); }
  destroy() { this.cancel(); this.abort.abort(); this.pixelObserver.disconnect(); this.eraserCursor.destroy(); cancelAnimationFrame(this.frame); }
}
