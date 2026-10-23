import type { Point, Stroke } from '../data/model';

export type XY = { x: number; y: number };
export interface BrushLayer { opacity: number; polygons: XY[][] }
export const graphiteSize = 32;
export const graphiteOpacities = [.2, .32, .44, .56, .68, .8, .91, 1];
export const graphiteOffset = (seed = 0) => ({ x: seed & 31, y: seed >>> 8 & 31 });
const clamp = (p: number) => Math.max(.02, Math.min(1, p));
const hash = (x: number, y: number) => {
  let v = Math.imul(x & 63, 374761393) ^ Math.imul(y & 63, 668265263) ^ 0x6d2b79f5;
  v = Math.imul(v ^ v >>> 13, 1274126177); return ((v ^ v >>> 16) >>> 0) / 0x100000000;
};

// One reusable paper-height material, shared by Canvas and vector PDF patterns.
// Adjacent cells share jittered corners: irregular graphite islands, no dot grid.
let material: BrushLayer[] | undefined;
export function graphiteMaterial(): BrushLayer[] {
  if (material) return material;
  const layers = [0, .18, .45, .72, .9, .98].map(opacity => ({ opacity, polygons: [] as XY[][] }));
  const corner = (x: number, y: number) => ({ x: (x + (hash(x, y) - .5) * .36) / 2, y: (y + (hash(x + 19, y + 37) - .5) * .36) / 2 });
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const value = hash(Math.floor(x / 2), Math.floor(y / 2)) * .65 + hash(x + 7, y + 23) * .35;
    const level = hash(x + 31, y + 9) < .07 || value < .18 ? 0 : value < .27 ? 1 : value < .36 ? 2 : value < .48 ? 3 : value < .66 ? 4 : 5;
    if (level) layers[level].polygons.push([corner(x, y), corner(x, y + 1), corner(x + 1, y + 1), corner(x + 1, y)]);
  }
  return material = layers.filter(layer => layer.polygons.length);
}

export function curvePiece(points: Point[], i: number): Point[] {
  if (points.length < 3) return points;
  const a = points[i - 1], b = points[i], c = points[i + 1] || b;
  const start = i === 1 ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2, t: a.t };
  const end = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2, p: (b.p + c.p) / 2, t: b.t };
  const count = Math.max(2, Math.min(12, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 3)));
  const result = [start];
  for (let n = 1; n <= count; n++) {
    const t = n / count, u = 1 - t;
    result.push({ x: u * u * start.x + 2 * u * t * b.x + t * t * end.x, y: u * u * start.y + 2 * u * t * b.y + t * t * end.y, p: start.p + (end.p - start.p) * t, t: b.t });
  }
  return result;
}
export function graphiteBand(points: Point[]) { return Math.min(7, Math.floor(clamp(points.reduce((sum, p) => sum + p.p, 0) / points.length) * 8)); }
export function ribbon(points: Point[], width: number): XY[][] {
  const left: XY[] = [], right: XY[] = [];
  const radius = (p: Point) => width * (.82 + .18 * clamp(p.p)) / 2;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2, r = radius(p);
    left.push({ x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r });
    right.push({ x: p.x - Math.cos(angle) * r, y: p.y - Math.sin(angle) * r });
  }
  const cap = (p: Point) => Array.from({ length: 12 }, (_, i) => ({ x: p.x + Math.cos(-i * Math.PI / 6) * radius(p), y: p.y + Math.sin(-i * Math.PI / 6) * radius(p) }));
  return [[...left, ...right.reverse()], cap(points[0]), cap(points[points.length - 1])];
}
export function pencilLayers(stroke: Stroke): BrushLayer[] {
  if (!stroke.points.length) return [];
  const layers = graphiteOpacities.map(opacity => ({ opacity, polygons: [] as XY[][] }));
  const add = (points: Point[]) => layers[graphiteBand(points)].polygons.push(...ribbon(points, stroke.width));
  if (stroke.points.length < 3) add(stroke.points);
  else for (let i = 1; i < stroke.points.length; i++) add(curvePiece(stroke.points, i));
  return layers.filter(layer => layer.polygons.length);
}
