type LaserPoint = { x: number; y: number; time: number };

// A temporary screen overlay. Laser marks never enter Page.items or exports.
export class LaserPointer {
  private canvas = document.createElement('canvas');
  private points: LaserPoint[] = [];
  private pointerId: number | null = null;
  private frame = 0;
  private observer: ResizeObserver;
  private abort = new AbortController();
  private enabled = false;

  constructor(private viewport: HTMLElement) {
    this.canvas.className = 'laser-overlay';
    this.canvas.hidden = true;
    this.canvas.setAttribute('aria-label', '레이저 포인터 영역');
    viewport.append(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(viewport);
    const signal = this.abort.signal;
    this.canvas.addEventListener('pointerdown', event => {
      if (!event.isPrimary) return;
      event.preventDefault(); event.stopPropagation();
      this.pointerId = event.pointerId;
      this.points = [];
      this.canvas.setPointerCapture(event.pointerId);
      this.add(event);
    }, { signal });
    this.canvas.addEventListener('pointermove', event => {
      event.stopPropagation();
      if (event.pointerId === this.pointerId || event.pointerType === 'pen' && this.pointerId === null) this.add(event);
    }, { signal });
    const end = (event: PointerEvent) => {
      event.stopPropagation();
      if (event.pointerId !== this.pointerId) return;
      this.pointerId = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      this.requestFrame();
    };
    this.canvas.addEventListener('pointerup', end, { signal });
    this.canvas.addEventListener('pointercancel', end, { signal });
    this.canvas.addEventListener('pointerleave', () => { if (this.pointerId === null) this.points = []; }, { signal });
  }

  private resize() {
    if (!this.enabled) return;
    const ratio = Math.min(devicePixelRatio || 1, 3);
    this.canvas.width = Math.max(1, Math.ceil(this.viewport.clientWidth * ratio));
    this.canvas.height = Math.max(1, Math.ceil(this.viewport.clientHeight * ratio));
    this.requestFrame();
  }

  private add(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.points.push({ x: event.clientX - rect.left, y: event.clientY - rect.top, time: performance.now() });
    if (this.points.length > 180) this.points.shift();
    this.requestFrame();
  }

  private requestFrame() { if (!this.frame && this.enabled) this.frame = requestAnimationFrame(() => this.draw()); }

  private draw() {
    this.frame = 0;
    const context = this.canvas.getContext('2d'); if (!context) return;
    const now = performance.now(), duration = this.pointerId === null ? 900 : 1400;
    this.points = this.points.filter(point => now - point.time < duration);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const scale = this.canvas.width / Math.max(1, this.viewport.clientWidth);
    context.save(); context.scale(scale, scale);
    context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#e84755';
    context.shadowColor = '#e84755'; context.shadowBlur = 9; context.lineWidth = 3;
    for (let index = 1; index < this.points.length; index++) {
      const a = this.points[index - 1], b = this.points[index];
      context.globalAlpha = Math.min(1, (duration - (now - b.time)) / 450);
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    }
    const last = this.points.at(-1);
    if (last) {
      context.globalAlpha = Math.min(1, (duration - (now - last.time)) / 450);
      context.fillStyle = '#e84755'; context.beginPath(); context.arc(last.x, last.y, 4, 0, Math.PI * 2); context.fill();
    }
    context.restore();
    if (this.points.length && this.enabled) this.requestFrame();
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled; this.canvas.hidden = !enabled;
    this.points = []; this.pointerId = null;
    cancelAnimationFrame(this.frame); this.frame = 0;
    if (enabled) this.resize();
  }

  destroy() { this.abort.abort(); this.observer.disconnect(); cancelAnimationFrame(this.frame); this.canvas.remove(); }
}
