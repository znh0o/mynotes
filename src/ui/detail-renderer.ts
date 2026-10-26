import type { Page, ShapeItem, Stroke } from '../data/model';
import { background } from '../data/pdf';
import { LiveStroke } from '../engine/LiveStroke';
import { drawItem, drawItems } from '../engine/render';
import { overlaps, paintBounds, type InkRect } from '../engine/geometry';

interface Tile {
  pageId: string; x: number; y: number; w: number; h: number;
  ratio: number; targetRatio: number; background: HTMLCanvasElement;
}

// The full-page canvases are bounded for memory. At high zoom, render only the
// visible part at the display's physical resolution, including the PDF and ink.
export class DetailRenderer {
  private canvas = document.createElement('canvas');
  private sharpLive = document.createElement('canvas');
  private sharpStroke = new LiveStroke();
  private currentPreview?: Stroke | ShapeItem;
  private observer: ResizeObserver;
  private pixelSize?: { cssWidth: number; deviceWidth: number };
  private page?: Page;
  private scale = 0;
  private tile?: Tile;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;

  constructor(private surface: HTMLElement, private live: HTMLCanvasElement,
    private viewport: HTMLElement, private baseBackground: HTMLCanvasElement,
    private baseInk: HTMLCanvasElement, private error: (error: unknown) => void) {
    this.canvas.className = 'paper-detail';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    this.canvas.style.pointerEvents = 'none';
    surface.insertBefore(this.canvas, live);
    this.sharpLive.className = 'paper-sharp-live';
    this.sharpLive.setAttribute('aria-hidden', 'true');
    this.sharpLive.hidden = true;
    this.sharpLive.style.pointerEvents = 'none';
    live.after(this.sharpLive);
    viewport.addEventListener('scroll', this.onScroll, { passive: true });
    this.observer = new ResizeObserver(entries => {
      const entry = entries[0], deviceWidth = entry?.devicePixelContentBoxSize?.[0]?.inlineSize;
      if (deviceWidth) {
        const cssWidth = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        this.pixelSize = { cssWidth, deviceWidth };
      }
      this.schedule();
    });
    try { this.observer.observe(surface, { box: 'device-pixel-content-box' }); }
    catch { this.observer.observe(surface); }
  }

  private onScroll = () => this.schedule();

  private release() {
    this.generation++;
    if (this.tile) this.tile.background.width = this.tile.background.height = 0;
    this.tile = undefined;
    this.canvas.hidden = true;
    if (this.canvas.width || this.canvas.height) this.canvas.width = this.canvas.height = 0;
    this.currentPreview = undefined;
    this.clearPreview(true);
  }

  private clearPreview(release = false) {
    this.sharpStroke.reset();
    const wasVisible = !this.sharpLive.hidden;
    this.sharpLive.hidden = true;
    this.live.style.opacity = '';
    if (release) this.sharpLive.width = this.sharpLive.height = 0;
    else if (wasVisible && this.sharpLive.width) {
      const ctx = this.sharpLive.getContext('2d')!;
      ctx.resetTransform(); ctx.clearRect(0, 0, this.sharpLive.width, this.sharpLive.height);
    }
  }

  preview(item: Stroke | ShapeItem | null, recompute = false) {
    if (recompute || item && this.currentPreview && item !== this.currentPreview) this.clearPreview();
    this.currentPreview = item ?? undefined;
    const tile = this.tile;
    if (!item || !tile || this.canvas.hidden || this.viewport.classList.contains('zoom-preview')) {
      this.clearPreview(); return;
    }
    if (this.sharpLive.width !== this.canvas.width || this.sharpLive.height !== this.canvas.height) {
      this.sharpLive.width = this.canvas.width; this.sharpLive.height = this.canvas.height;
      this.sharpStroke.reset();
    }
    this.sharpLive.style.left = this.canvas.style.left; this.sharpLive.style.top = this.canvas.style.top;
    this.sharpLive.style.width = this.canvas.style.width; this.sharpLive.style.height = this.canvas.style.height;
    const ctx = this.sharpLive.getContext('2d')!;
    ctx.setTransform(tile.ratio, 0, 0, tile.ratio, -tile.x * tile.ratio, -tile.y * tile.ratio);
    if (item.kind !== 'stroke' || !this.sharpStroke.draw(ctx, item, tile.ratio)) {
      ctx.resetTransform(); ctx.clearRect(0, 0, this.sharpLive.width, this.sharpLive.height);
      ctx.setTransform(tile.ratio, 0, 0, tile.ratio, -tile.x * tile.ratio, -tile.y * tile.ratio);
      drawItem(ctx, item);
    }
    this.sharpLive.hidden = false;
    this.live.style.opacity = '0';
  }

  suspend() {
    clearTimeout(this.timer);
    this.release();
  }

  set(page: Page | undefined, scale: number) {
    if (this.page?.id !== page?.id || this.scale !== scale) this.release();
    this.page = page; this.scale = scale;
    this.schedule();
  }

  schedule(delay = 70) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.render().catch(this.error); }, delay);
  }

  refreshInk(page: Page, region?: InkRect) {
    if (this.tile?.pageId !== page.id || this.page?.id !== page.id) return;
    const tile = this.tile, ctx = this.canvas.getContext('2d')!;
    if (region && !overlaps(tile, region)) return;
    if (region) {
      const x = Math.floor((region.x - tile.x) * tile.ratio) / tile.ratio + tile.x;
      const y = Math.floor((region.y - tile.y) * tile.ratio) / tile.ratio + tile.y;
      region = { x, y, w: Math.ceil((region.x + region.w - tile.x) * tile.ratio) / tile.ratio + tile.x - x,
        h: Math.ceil((region.y + region.h - tile.y) * tile.ratio) / tile.ratio + tile.y - y };
    }
    ctx.save();
    if (region) {
      ctx.setTransform(tile.ratio, 0, 0, tile.ratio, -tile.x * tile.ratio, -tile.y * tile.ratio);
      ctx.beginPath(); ctx.rect(region.x, region.y, region.w, region.h); ctx.clip();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tile.background, 0, 0);
    ctx.setTransform(tile.ratio, 0, 0, tile.ratio, -tile.x * tile.ratio, -tile.y * tile.ratio);
    drawItems(ctx, region ? page.items.filter(item => overlaps(paintBounds(item), region)) : page.items);
    ctx.restore();
  }

  private async render() {
    if (this.viewport.classList.contains('zoom-preview')) return;
    const page = this.page, surface = this.surface.getBoundingClientRect(), view = this.viewport.getBoundingClientRect();
    if (!page || !surface.width || !surface.height || !this.baseBackground.width || !this.baseInk.width) return;
    const cssScale = surface.width / page.width;
    const x0 = Math.max(0, (view.left - surface.left) / cssScale);
    const y0 = Math.max(0, (view.top - surface.top) / cssScale);
    const x1 = Math.min(page.width, (view.right - surface.left) / cssScale);
    const y1 = Math.min(page.height, (view.bottom - surface.top) / cssScale);
    if (x1 <= x0 || y1 <= y0) { this.release(); return; }
    const deviceScale = this.pixelSize && Math.abs(this.pixelSize.cssWidth - surface.width) < 1
      ? Math.max(devicePixelRatio, this.pixelSize.deviceWidth / this.pixelSize.cssWidth) : devicePixelRatio;
    const targetRatio = cssScale * deviceScale;
    const baseRatio = Math.min(this.baseBackground.width / page.width, this.baseInk.width / page.width);
    if (targetRatio <= baseRatio * 1.08) { this.release(); return; }
    const margin = Math.min(72, Math.min(view.width, view.height) * .08) / cssScale;
    const tile = this.tile, guard = margin / 3;
    if (tile?.pageId === page.id && Math.abs(tile.targetRatio - targetRatio) < .02 &&
      x0 >= tile.x + (tile.x ? guard : 0) && y0 >= tile.y + (tile.y ? guard : 0) &&
      x1 <= tile.x + tile.w - (tile.x + tile.w < page.width ? guard : 0) &&
      y1 <= tile.y + tile.h - (tile.y + tile.h < page.height ? guard : 0)) return;
    const x = Math.max(0, x0 - margin), y = Math.max(0, y0 - margin);
    const w = Math.min(page.width, x1 + margin) - x, h = Math.min(page.height, y1 + margin) - y;
    const ratio = Math.min(targetRatio, Math.sqrt(8000000 / (w * h)));
    if (ratio <= baseRatio * 1.04) { this.release(); return; }
    const generation = ++this.generation, temp = document.createElement('canvas');
    await background(temp, page, ratio, { x, y, w, h });
    if (generation !== this.generation || this.page?.id !== page.id || this.viewport.classList.contains('zoom-preview')) {
      temp.width = temp.height = 0; return;
    }
    const previous = this.tile?.background;
    this.clearPreview();
    this.tile = { pageId: page.id, x, y, w, h, ratio, targetRatio, background: temp };
    this.canvas.width = temp.width; this.canvas.height = temp.height;
    this.canvas.style.left = `${x * cssScale}px`; this.canvas.style.top = `${y * cssScale}px`;
    this.canvas.style.width = `${w * cssScale}px`; this.canvas.style.height = `${h * cssScale}px`;
    this.refreshInk(page);
    this.canvas.hidden = false;
    if (this.currentPreview) this.preview(this.currentPreview);
    if (previous) previous.width = previous.height = 0;
  }

  destroy() {
    clearTimeout(this.timer);
    this.observer.disconnect();
    this.viewport.removeEventListener('scroll', this.onScroll);
    this.release();
    this.canvas.remove();
    this.sharpLive.remove();
  }
}
