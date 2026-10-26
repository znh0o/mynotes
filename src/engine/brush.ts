import type { Point, Stroke } from '../data/model';
import { pencilLayers, type BrushLayer } from './graphite';
export type { BrushLayer } from './graphite';

type XY = { x: number; y: number };
const pressure = (p: number) => Math.max(.02, Math.min(1, p));
const circle = (point: XY, radius: number) => Array.from({ length: 16 }, (_, i) => ({
  x: point.x + Math.cos(-i * Math.PI / 8) * radius, y: point.y + Math.sin(-i * Math.PI / 8) * radius
}));

// A stylus often reports near-zero pressure on contact and release. Keep its
// interior pressure variation, but prevent those samples forming long needles.
export function roundedEndRadii(points: Point[], radii: number[], width: number): number[] {
  if (points.length < 2) return radii;
  const distances = [0];
  for (let i = 1; i < points.length; i++)
    distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const length = distances[distances.length - 1], reach = Math.min(width * 4, length / 3);
  if (!reach) return radii;
  let start = 0, end = 0;
  for (let i = 0; i < radii.length; i++) {
    if (distances[i] <= reach) start = Math.max(start, radii[i]);
    if (length - distances[i] <= reach) end = Math.max(end, radii[i]);
  }
  start *= .8; end *= .8;
  return radii.map((radius, i) => Math.max(radius,
    distances[i] <= reach ? start : 0, length - distances[i] <= reach ? end : 0));
}

// These page-coordinate polygons are shared by Canvas, thumbnails and PDF.
// Persisted seeds keep graphite identical after redraw, reload and backup.
export function brushLayers(stroke: Stroke, sampled?: Point[]): BrushLayer[] {
  if (stroke.tool === 'pencil') return pencilLayers(stroke);
  const points = sampled ?? smooth(stroke.points);
  if (!points.length) return [];
  const normals: number[] = [], raw: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i], prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const direction = Math.atan2(next.y - prev.y, next.x - prev.x);
    const nib = .5 + .5 * Math.abs(Math.sin(direction - Math.PI / 4));
    normals.push(direction + Math.PI / 2);
    raw.push(stroke.width / 2 * (.12 + .88 * Math.pow(pressure(point.p), .9)) * nib);
  }
  const radii = roundedEndRadii(points, raw, stroke.width);
  const left: XY[] = [], right: XY[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i], normal = normals[i], radius = radii[i];
    left.push({ x: point.x + Math.cos(normal) * radius, y: point.y + Math.sin(normal) * radius });
    right.push({ x: point.x - Math.cos(normal) * radius, y: point.y - Math.sin(normal) * radius });
  }
  const body = [[...left, ...right.reverse()], circle(points[0], radii[0]), circle(points[points.length - 1], radii[radii.length - 1])];
  return [{ opacity: 1, polygons: body }];
}

export function smooth(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const output: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1] || b;
    const start = i === 1 ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2, t: a.t };
    const end = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2, p: (b.p + c.p) / 2, t: b.t };
    const steps = Math.max(2, Math.min(12, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 3)));
    for (let n = 1; n <= steps; n++) {
      const t = n / steps, u = 1 - t;
      output.push({ x: u * u * start.x + 2 * u * t * b.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * b.y + t * t * end.y,
        p: start.p + (end.p - start.p) * t, t: b.t });
    }
  }
  output.push(points[points.length - 1]);
  return output;
}
