import { graphiteMaterial, graphiteOffset, graphiteSize } from './graphite';

const sources = new Map<string, HTMLCanvasElement>();
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
export function graphitePattern(ctx: CanvasRenderingContext2D, color: string, seed?: number) {
  let cache = patterns.get(ctx); if (!cache) patterns.set(ctx, cache = new Map());
  let pattern = cache.get(color);
  if (!pattern) {
    let tile = sources.get(color);
    if (!tile) {
      tile = document.createElement('canvas'); tile.width = tile.height = graphiteSize * 4;
      const paint = tile.getContext('2d')!; paint.scale(4, 4); paint.fillStyle = color;
      for (const layer of graphiteMaterial()) {
        paint.globalAlpha = layer.opacity; paint.beginPath();
        for (const polygon of layer.polygons) { paint.moveTo(polygon[0].x, polygon[0].y); polygon.slice(1).forEach(p => paint.lineTo(p.x, p.y)); paint.closePath(); }
        paint.fill();
      }
      if (sources.size >= 12) sources.delete(sources.keys().next().value!);
      sources.set(color, tile);
    }
    pattern = ctx.createPattern(tile, 'repeat')!;
    if (cache.size >= 12) cache.delete(cache.keys().next().value!);
    cache.set(color, pattern);
  }
  const offset = graphiteOffset(seed);
  pattern.setTransform(new DOMMatrix([.25, 0, 0, .25, offset.x, offset.y]));
  return pattern;
}
