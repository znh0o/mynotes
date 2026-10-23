import type { Point, Stroke } from '../data/model';

export type XY = { x: number; y: number };
export interface BrushLayer { opacity: number; polygons: XY[][] }
export const graphiteSize = 32;
export const graphiteScale = 1.1;
export const graphiteOpacities = [.2, .32, .44, .56, .68, .8, .91, 1];
export const pencilOpacities = (stroke: Stroke) => stroke.pencilDarkness === undefined ? graphiteOpacities : [stroke.pencilDarkness];
export const graphiteOffset = (seed = 0) => ({ x: seed & 31, y: seed >>> 8 & 31 });
const clamp = (p: number) => Math.max(.02, Math.min(1, p));
const hash = (x: number, y: number) => {
  let v = Math.imul(x & 63, 374761393) ^ Math.imul(y & 63, 668265263) ^ 0x6d2b79f5;
  v = Math.imul(v ^ v >>> 13, 1274126177); return ((v ^ v >>> 16) >>> 0) / 0x100000000;
};
const paperHeight = (x: number, y: number) => {
  const a = Math.floor(x / 4), b = Math.floor(y / 4);
  const smooth = (n: number) => n * n * (3 - 2 * n);
  const u = smooth(x / 4 - a), v = smooth(y / 4 - b);
  const sample = (x: number, y: number) => hash(x & 15, y & 15);
  return (sample(a, b) * (1 - u) + sample(a + 1, b) * u) * (1 - v)
    + (sample(a, b + 1) * (1 - u) + sample(a + 1, b + 1) * u) * v;
};

// One reusable paper-height material, shared by Canvas and vector PDF patterns.
// Adjacent cells share jittered corners: irregular graphite islands, no dot grid.
const materials = new Map<boolean, BrushLayer[]>();
export function graphiteMaterial(wide = false): BrushLayer[] {
  const cached = materials.get(wide); if (cached) return cached;
  const base = .52;
  const layers = [.52, .62, .72, .82, .92, 1].map(opacity => ({ opacity: (opacity - base) / (1 - base), polygons: [] as XY[][] }));
  const corner = (x: number, y: number) => ({ x: (x + (hash(x, y) - .5) * .36) / 2, y: (y + (hash(x + 19, y + 37) - .5) * .36) / 2 });
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    // Broad, connected deposits follow the paper relief. A small fine-grain
    // component breaks up their edges without isolated white/noisy pixels.
    // Wide lead uses short, slanted graphite fibres rather than enlarging
    // the thin lead's cloudy deposits into a broad, smooth band.
    const fibre = hash(Math.floor((x + y) / 3), Math.floor((y - x + 64) / 2));
    const value = wide ? paperHeight(x, y) * .28 + fibre * .54 + hash(x + 7, y + 23) * .18
      : paperHeight(x, y) * .86 + hash(x + 7, y + 23) * .14;
    const level = value < .22 ? 0 : value < .32 ? 1 : value < .43 ? 2 : value < .55 ? 3 : value < .67 ? 4 : 5;
    if (level) layers[level].polygons.push([corner(x, y), corner(x, y + 1), corner(x + 1, y + 1), corner(x + 1, y)]);
  }
  // A paper-wide graphite base prevents subpixel seams between neighboring
  // cells from becoming white specks, including in PDF vector rasterizers.
  const material = [{ opacity: base, polygons: [[{ x: 0, y: 0 }, { x: 0, y: graphiteSize }, { x: graphiteSize, y: graphiteSize }, { x: graphiteSize, y: 0 }]] }, ...layers.filter(layer => layer.polygons.length)];
  materials.set(wide, material); return material;
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
export function graphiteBand(points: Point[], stroke?: Stroke) { return stroke?.pencilDarkness !== undefined ? 0 : Math.min(7, Math.floor(clamp(points.reduce((sum, p) => sum + p.p, 0) / points.length) * 8)); }
export function ribbon(points: Point[], width: number, fixed = false): XY[][] {
  const left: XY[] = [], right: XY[] = [];
  const edge = fixed && width > 1.5 ? Math.min(.22, (width - 1.5) * .045) : 0;
  const radius = (p: Point, side = 0) => width * (fixed ? 1 : .82 + .18 * clamp(p.p)) / 2
    + (edge ? edge * (paperHeight(p.x * 2 + side * 17, p.y * 2 + side * 29) * 2 - 1) : 0);
  for (let i = 0; i < points.length; i++) {
    const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2, r = radius(p), opposite = radius(p, 1);
    left.push({ x: p.x + Math.cos(angle) * r, y: p.y + Math.sin(angle) * r });
    right.push({ x: p.x - Math.cos(angle) * opposite, y: p.y - Math.sin(angle) * opposite });
  }
  const cap = (p: Point) => Array.from({ length: 12 }, (_, i) => ({ x: p.x + Math.cos(-i * Math.PI / 6) * radius(p), y: p.y + Math.sin(-i * Math.PI / 6) * radius(p) }));
  return [[...left, ...right.reverse()], cap(points[0]), cap(points[points.length - 1])];
}
export function pencilLayers(stroke: Stroke): BrushLayer[] {
  if (!stroke.points.length) return [];
  const layers = pencilOpacities(stroke).map(opacity => ({ opacity, polygons: [] as XY[][] }));
  const add = (points: Point[]) => layers[graphiteBand(points, stroke)].polygons.push(...ribbon(points, stroke.width, stroke.pencilDarkness !== undefined));
  if (stroke.points.length < 3) add(stroke.points);
  else for (let i = 1; i < stroke.points.length; i++) add(curvePiece(stroke.points, i));
  return layers.filter(layer => layer.polygons.length);
}
