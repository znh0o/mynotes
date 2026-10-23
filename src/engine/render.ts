import { smooth, brushLayers } from './brush';
import { graphitePattern } from './graphite-pattern';
import { drawText } from './text';
export { smooth } from './brush';
import type { Item, Page, Stroke } from '../data/model';
export const imageCache = new Map<string, HTMLImageElement>();
interface CachedBrush { width: number; seed?: number; darkness?: number; tool: Stroke['tool']; points: Float64Array; layers: { opacity: number; path: Path2D }[] }
const brushCache = new WeakMap<Stroke, CachedBrush>();
export function rememberBrush(stroke: Stroke, layers: CachedBrush['layers']) {
  const points = new Float64Array(stroke.points.length * 3);
  stroke.points.forEach((point, i) => { points[i * 3] = point.x; points[i * 3 + 1] = point.y; points[i * 3 + 2] = point.p; });
  brushCache.set(stroke, { width: stroke.width, seed: stroke.textureSeed, darkness: stroke.pencilDarkness, tool: stroke.tool, points, layers });
}
function brushPaths(stroke: Stroke) {
  const previous = brushCache.get(stroke);
  if (previous && previous.width === stroke.width && previous.seed === stroke.textureSeed && previous.darkness === stroke.pencilDarkness && previous.tool === stroke.tool && previous.points.length === stroke.points.length * 3 &&
    stroke.points.every((point, i) => previous.points[i * 3] === point.x && previous.points[i * 3 + 1] === point.y && previous.points[i * 3 + 2] === point.p)) return previous.layers;
  const layers = brushLayers(stroke).map(layer => {
    const path = new Path2D();
    for (const polygon of layer.polygons) {
      path.moveTo(polygon[0].x, polygon[0].y);
      for (let i = 1; i < polygon.length; i++) path.lineTo(polygon[i].x, polygon[i].y);
      path.closePath();
    }
    return { opacity: layer.opacity, path };
  });
  rememberBrush(stroke, layers);
  return layers;
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (!stroke.points.length) return;
  if (stroke.tool === 'pencil' || stroke.tool === 'fountain' && stroke.brushVersion === 2) {
    ctx.save(); ctx.fillStyle = stroke.tool === 'pencil' ? graphitePattern(ctx, stroke.color, stroke.textureSeed) : stroke.color;
    for (const layer of brushPaths(stroke)) { ctx.globalAlpha = layer.opacity; ctx.fill(layer.path); }
    ctx.restore(); return;
  }
  const pts = smooth(stroke.points);
  ctx.save(); ctx.fillStyle = stroke.color; ctx.strokeStyle = stroke.color;
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (stroke.tool === 'highlighter' || !stroke.pressure) {
    ctx.globalAlpha = stroke.tool === 'highlighter' ? .32 : 1;
    ctx.lineWidth = stroke.width;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    if (pts.length === 1) { ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.stroke();
  } else {
    const left: {x: number; y: number}[] = [], right: {x: number; y: number}[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)], p = pts[i];
      const angle = Math.atan2(next.y - prev.y, next.x - prev.x) + Math.PI / 2;
      const radius = stroke.width * (.22 + .78 * Math.pow(Math.max(.05, p.p), .65)) / 2;
      left.push({ x: p.x + Math.cos(angle) * radius, y: p.y + Math.sin(angle) * radius });
      right.push({ x: p.x - Math.cos(angle) * radius, y: p.y - Math.sin(angle) * radius });
    }
    ctx.beginPath(); ctx.moveTo(left[0].x, left[0].y);
    left.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    right.reverse().forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.fill();
    for (const p of [pts[0], pts[pts.length - 1]]) {
      ctx.beginPath(); ctx.arc(p.x, p.y, stroke.width * (.22 + .78 * Math.pow(Math.max(.05, p.p), .65)) / 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
export function drawItem(ctx: CanvasRenderingContext2D, item: Item) {
  if (item.kind === 'stroke') return drawStroke(ctx, item);
  ctx.save();
  if (item.kind === 'text') {
    drawText(ctx, item);
  } else if (item.kind === 'image') {
    const image = imageCache.get(item.assetId); if (image) ctx.drawImage(image, item.x, item.y, item.w, item.h);
  } else {
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.strokeStyle = item.color; ctx.lineWidth = item.width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
    if (item.shape === 'line') { ctx.moveTo(item.x, item.y); ctx.lineTo(item.x + item.w, item.y + item.h); }
    if (item.shape === 'rect') ctx.rect(item.x, item.y, item.w, item.h);
    if (item.shape === 'ellipse') ctx.ellipse(item.x + item.w / 2, item.y + item.h / 2, Math.abs(item.w / 2), Math.abs(item.h / 2), 0, 0, Math.PI * 2);
    if (item.shape === 'triangle') { ctx.moveTo(item.x + item.w / 2, item.y); ctx.lineTo(item.x + item.w, item.y + item.h); ctx.lineTo(item.x, item.y + item.h); ctx.closePath(); }
    ctx.stroke();
  }
  ctx.restore();
}
export function drawPaper(ctx: CanvasRenderingContext2D, page: Page) {
  const { width: w, height: h, spacing: s, paper } = page;
  ctx.fillStyle = page.paperColor; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#bdc9d64d'; ctx.fillStyle = '#b3bfce99'; ctx.lineWidth = .8;
  ctx.beginPath();
  if (paper === 'lined' || paper === 'cornell') for (let y = 96; y < h - 55; y += s) { ctx.moveTo(48, y); ctx.lineTo(w - 48, y); }
  if (paper === 'grid') {
    for (let x = 32; x < w - 20; x += s) { ctx.moveTo(x, 32); ctx.lineTo(x, h - 32); }
    for (let y = 32; y < h - 20; y += s) { ctx.moveTo(32, y); ctx.lineTo(w - 32, y); }
  }
  if (paper === 'dots') for (let y = 40; y < h - 20; y += s) for (let x = 40; x < w - 20; x += s) { ctx.moveTo(x, y); ctx.arc(x, y, 1, 0, Math.PI * 2); }
  if (paper === 'cornell') { ctx.moveTo(w * .27, 64); ctx.lineTo(w * .27, h - 200); ctx.moveTo(48, h - 200); ctx.lineTo(w - 48, h - 200); }
  if (paper === 'planner') {
    ctx.font = '20px sans-serif'; ctx.fillStyle = '#8396ab'; ctx.fillText('W E E K L Y   P L A N', 48, 65);
    ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach((day, i) => {
      const y = 108 + (h - 156) / 7 * i;
      ctx.font = '12px sans-serif'; ctx.fillText(day, 50, y + 26);
      ctx.moveTo(48, y); ctx.lineTo(w - 48, y); ctx.moveTo(112, y); ctx.lineTo(112, y + (h - 156) / 7);
    });
  }
  if (paper === 'dots') ctx.fill(); else ctx.stroke();
}
export function drawItems(ctx: CanvasRenderingContext2D, items: Item[]) { items.forEach(item => drawItem(ctx, item)); }
