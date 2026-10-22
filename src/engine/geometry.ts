import { uid, type Item, type Point, type Stroke } from '../data/model';
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
    if (i.kind === 'stroke') { i.points.forEach(point); i.width *= scale; }
    else { point(i); i.w *= scale; i.h *= scale; if (i.kind === 'text') i.size *= scale; }
  }
}
// Resample against the whole swept eraser segment, preserving pressure/time at cuts.
export function erase(items: Item[], a: Point, b: Point, radius: number, partial: boolean): Item[] {
  return items.flatMap((item): Item[] => {
    if (item.kind !== 'stroke') return [item];
    const r = radius + item.width / 2;
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
    if (!partial) return [];
    return chunks.filter(c => c.length > 0).map(points => ({ ...item, id: uid(), points } as Stroke));
  });
}
