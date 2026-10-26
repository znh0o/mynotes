import { uid, type Item, type Point, type Stroke } from '../data/model';
export interface InkRect { x: number; y: number; w: number; h: number }
const strokeBoxes = new WeakMap<Stroke, { points: Point[]; count: number; width: number; box: InkRect }>();
export function paintBounds(item: Item): InkRect {
  if (item.kind !== 'stroke') {
    const pad = item.kind === 'shape' ? item.width / 2 + 2 : 4;
    return { x: Math.min(item.x, item.x + item.w) - pad, y: Math.min(item.y, item.y + item.h) - pad,
      w: Math.abs(item.w) + pad * 2, h: Math.abs(item.h) + pad * 2 };
  }
  const cached = strokeBoxes.get(item);
  if (cached?.points === item.points && cached.count === item.points.length && cached.width === item.width) return cached.box;
  const b = bounds([item]), pad = item.width / 2 + 2;
  const box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  strokeBoxes.set(item, { points: item.points, count: item.points.length, width: item.width, box });
  return box;
}
export function overlaps(a: InkRect, b: InkRect) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}
export function union(a: InkRect, b: InkRect): InkRect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function inside(p: { x: number; y: number }, polygon: Point[]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
export function bounds(items: Item[]) {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  const visit = (p: {x: number; y: number}) => { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); };
  for (const i of items) {
    if (i.kind === 'stroke') i.points.forEach(visit);
    else { visit(i); visit({ x: i.x + i.w, y: i.y + i.h }); }
  }
  return Number.isFinite(x) ? { x, y, w: right - x, h: bottom - y } : { x: 0, y: 0, w: 0, h: 0 };
}
export function transform(items: Item[], dx: number, dy: number, scale = 1, origin = bounds(items)) {
  for (const i of items) {
    const point = (p: { x: number; y: number }) => { p.x = origin.x + (p.x - origin.x) * scale + dx; p.y = origin.y + (p.y - origin.y) * scale + dy; };
    if (i.kind === 'stroke') { strokeBoxes.delete(i); i.points.forEach(point); i.width *= scale; }
    else { point(i); i.w *= scale; i.h *= scale; if (i.kind === 'text') i.size *= scale; }
  }
}
// Resample against the whole swept eraser segment, preserving pressure/time at cuts.
export function erase(items: Item[], a: Point, b: Point, radius: number, partial: boolean,
  erased?: (stroke: Stroke) => void): Item[] {
  const area = { x: Math.min(a.x, b.x) - radius, y: Math.min(a.y, b.y) - radius,
    w: Math.abs(b.x - a.x) + radius * 2, h: Math.abs(b.y - a.y) + radius * 2 };
  let changed = false;
  const result = items.flatMap((item): Item[] => {
    if (item.kind !== 'stroke') return [item];
    if (!overlaps(area, paintBounds(item))) return [item];
    const r = radius + item.width / 2;
    if (!partial) {
      const cross = (p: Point, q: Point, s: Point) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
      const hit = item.points.some((to, k) => {
        const from = item.points[Math.max(0, k - 1)];
        const intersects = cross(a, b, from) * cross(a, b, to) <= 0 && cross(from, to, a) * cross(from, to, b) <= 0;
        return intersects && overlaps({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) },
          { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(from.x - to.x), h: Math.abs(from.y - to.y) }) ||
          distanceToSegment(from, a, b) <= r || distanceToSegment(to, a, b) <= r ||
          distanceToSegment(a, from, to) <= r || distanceToSegment(b, from, to) <= r;
      });
      if (!hit) return [item];
      changed = true; erased?.(item); return [];
    }
    let hit = false;
    const chunks: Point[][] = [[]];
    const push = (p: Point) => {
      if (distanceToSegment(p, a, b) <= r) { hit = true; if (chunks[chunks.length - 1].length) chunks.push([]); }
      else chunks[chunks.length - 1].push(p);
    };
    if (item.points.length === 1) push(item.points[0]);
    for (let k = 1; k < item.points.length; k++) {
      const from = item.points[k - 1], to = item.points[k];
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, r / 3)));
      for (let n = k === 1 ? 0 : 1; n <= steps; n++) {
        const t = n / steps;
        push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, p: from.p + (to.p - from.p) * t, t: from.t + (to.t - from.t) * t });
      }
    }
    if (!hit) return [item];
    changed = true; erased?.(item);
    return chunks.filter(c => c.length > 0).map(points => ({ ...item, id: uid(), points } as Stroke));
  });
  return changed ? result : items;
}
