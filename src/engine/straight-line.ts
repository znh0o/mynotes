import type { Point, Stroke } from '../data/model';
import { distanceToSegment } from './geometry';

export function canStraighten(points: Point[]) {
  if (points.length < 3) return false;
  const a = points[0], b = points[points.length - 1], chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord < 24) return false;
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length < chord * 1.5 && points.every(p => distanceToSegment(p, a, b) < chord * .18 + 5);
}

export function straightPoints(source: Stroke['points'], end: Point): Point[] {
  const start = source[0], count = Math.min(32, source.length);
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1), sample = source[Math.round(t * (source.length - 1))];
    return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, p: sample.p, t: start.t + (end.t - start.t) * t };
  });
}
