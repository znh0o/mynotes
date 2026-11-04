type LaserPoint = { x: number; y: number; time: number };

// A temporary screen overlay. Laser marks never enter Page.items or exports.
export class LaserPointer {
  private canvas = document.createElement('canvas');
  private points: LaserPoint[] = [];
  private head: LaserPoint | null = null;
  private penPresent = false;
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
    viewport.addEventListener('pointerdown', event => {
      if (!this.enabled || event.pointerType !== 'pen' || !event.isPrimary) return;
      event.preventDefault(); event.stopPropagation();
      this.penPresent = true;
      this.pointerId = event.pointerId;
      this.points = [];
      viewport.setPointerCapture(event.pointerId);
      this.add(event);
    }, { signal, capture: true });
    viewport.addEventListener('pointermove', event => {
      if (!this.enabled || event.pointerType !== 'pen') return;
      event.stopPropagation();
      this.penPresent = true;
      if (event.pointerId === this.pointerId || this.pointerId === null) this.add(event);
    }, { signal, capture: true });
    const end = (event: PointerEvent) => {
      if (!this.enabled || event.pointerType !== 'pen') return;
      event.stopPropagation();
      if (event.pointerId !== this.pointerId) return;
      this.pointerId = null;
      if (this.head) this.head.time = performance.now();
      this.penPresent = false;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      this.requestFrame();
    };
    viewport.addEventListener('pointerup', end, { signal, capture: true });
    viewport.addEventListener('pointercancel', end, { signal, capture: true });
    viewport.addEventListener('pointerleave', event => {
      if (!this.enabled || event.pointerType !== 'pen') return;
      this.penPresent = false;
      if (this.head) this.head.time = performance.now();
      this.requestFrame();
    }, { signal });
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
    this.head = { x: event.clientX - rect.left, y: event.clientY - rect.top, time: performance.now() };
    this.points.push({ ...this.head });
    if (this.points.length > 180) this.points.shift();
    this.requestFrame();
  }

  private requestFrame() { if (!this.frame && this.enabled) this.frame = requestAnimationFrame(() => this.draw()); }

  private draw() {
    this.frame = 0;
    const context = this.canvas.getContext('2d'); if (!context) return;
    const now = performance.now(), duration = 220;
    this.points = this.points.filter(point => now - point.time < duration && (!this.head || Math.hypot(this.head.x - point.x, this.head.y - point.y) < 42));
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const scale = this.canvas.width / Math.max(1, this.viewport.clientWidth);
    context.save(); context.scale(scale, scale);
    context.lineCap = 'round'; context.lineJoin = 'round';
    for (let index = 1; index < this.points.length; index++) {
      const a = this.points[index - 1], b = this.points[index];
      const life = Math.max(0, 1 - (now - b.time) / duration);
      const distance = Math.hypot(b.x - a.x, b.y - a.y), portion = Math.min(1, 24 / Math.max(1, distance));
      context.beginPath(); context.moveTo(b.x + (a.x - b.x) * portion, b.y + (a.y - b.y) * portion); context.lineTo(b.x, b.y);
      context.strokeStyle = `rgba(238, 44, 72, ${life * .12})`;
      context.lineWidth = 15 * life; context.stroke();
      context.strokeStyle = `rgba(255, 79, 93, ${life * .26})`;
      context.lineWidth = 4 * life; context.stroke();
    }
    const head = this.head, life = head ? this.penPresent ? 1 : Math.max(0, 1 - (now - head.time) / 520) : 0;
    if (head && life) {
      const halo = context.createRadialGradient(head.x, head.y, 0, head.x, head.y, 18);
      halo.addColorStop(0, `rgba(255,255,255,${life})`);
      halo.addColorStop(.16, `rgba(255,61,78,${life})`);
      halo.addColorStop(.38, `rgba(255,70,90,${life * .38})`);
      halo.addColorStop(1, 'rgba(255,70,90,0)');
      context.fillStyle = halo; context.beginPath(); context.arc(head.x, head.y, 18, 0, Math.PI * 2); context.fill();
      context.strokeStyle = `rgba(224, 37, 62, ${life * .85})`; context.lineWidth = 1.4;
      context.beginPath(); context.arc(head.x, head.y, 5.5, 0, Math.PI * 2); context.stroke();
      context.fillStyle = `rgba(255,255,255,${life})`;
      context.beginPath(); context.arc(head.x, head.y, 2.3, 0, Math.PI * 2); context.fill();
    }
    context.restore();
    if (!life) this.head = null;
    if (this.enabled && (this.points.length || this.head && !this.penPresent)) this.requestFrame();
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    if (!enabled && this.pointerId !== null && this.viewport.hasPointerCapture(this.pointerId)) this.viewport.releasePointerCapture(this.pointerId);
    this.enabled = enabled; this.canvas.hidden = !enabled;
    this.points = []; this.head = null; this.penPresent = false; this.pointerId = null;
    cancelAnimationFrame(this.frame); this.frame = 0;
    if (enabled) this.resize();
  }

  destroy() { this.setEnabled(false); this.abort.abort(); this.observer.disconnect(); cancelAnimationFrame(this.frame); this.canvas.remove(); }
}
