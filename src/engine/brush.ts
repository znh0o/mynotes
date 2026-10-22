import type { Point, Stroke } from '../data/model';

type XY = { x: number; y: number };
export interface BrushLayer { opacity: number; polygons: XY[][] }
const pressure = (p: number) => Math.max(.02, Math.min(1, p));
const circle = (point: XY, radius: number) => Array.from({ length: 16 }, (_, i) => ({
  x: point.x + Math.cos(-i * Math.PI / 8) * radius, y: point.y + Math.sin(-i * Math.PI / 8) * radius
}));

// These page-coordinate polygons are shared by Canvas, thumbnails and PDF.
// Persisted seeds keep graphite identical after redraw, reload and backup.
export function brushLayers(stroke: Stroke, points = smooth(stroke.points)): BrushLayer[] {
  if (!points.length) return [];
  let state = (stroke.textureSeed ?? 0x6d2b79f5) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const length = distances[distances.length - 1], pencil = stroke.tool === 'pencil';
  const left: XY[] = [], right: XY[] = [], radii: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i], prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const direction = Math.atan2(next.y - prev.y, next.x - prev.x), normal = direction + Math.PI / 2;
    const p = pressure(point.p);
    const nib = .5 + .5 * Math.abs(Math.sin(direction - Math.PI / 4));
    const taperLength = Math.min(stroke.width * 1.8, length / 3);
    const taper = length > stroke.width * 2 ? .42 + .58 * Math.min(1, Math.min(distances[i], length - distances[i]) / Math.max(.01, taperLength)) : 1;
    const radius = stroke.width / 2 * (pencil ? (.78 + .22 * p) * (.92 + random() * .08) : (.12 + .88 * Math.pow(p, .9)) * nib * taper);
    radii.push(radius);
    left.push({ x: point.x + Math.cos(normal) * radius, y: point.y + Math.sin(normal) * radius });
    right.push({ x: point.x - Math.cos(normal) * radius, y: point.y - Math.sin(normal) * radius });
  }
  const body = [[...left, ...right.reverse()], circle(points[0], radii[0]), circle(points[points.length - 1], radii[radii.length - 1])];
  if (!pencil) return [{ opacity: 1, polygons: body }];
  // Dense, broken graphite coverage rather than a pale solid tube with dots.
  // Adjacent irregular deposits leave the paper visible between dark grains.
  const layers: BrushLayer[] = [{ opacity: .06, polygons: body }, ...[.38, .55, .72, .88].map(opacity => ({ opacity, polygons: [] as XY[][] }))];
  const step = .85, lanes = Math.max(2, Math.min(18, Math.ceil(stroke.width / .85)));
  // Edge sampling grows during a live stroke. Give the graphite a separate
  // stream so extending the tip never shuffles grains already on the paper.
  state = ((stroke.textureSeed ?? 0x6d2b79f5) ^ 0xa511e9b3) >>> 0;
  let index = 1;
  for (let distance = 0; distance <= length; distance += step) {
    while (index < distances.length - 1 && distances[index] < distance) index++;
    const a = points[Math.max(0, index - 1)], b = points[Math.min(points.length - 1, index)];
    const span = distances[Math.min(index, distances.length - 1)] - distances[Math.max(0, index - 1)];
    const t = span > 0 ? (distance - distances[Math.max(0, index - 1)]) / span : 0;
    const p = pressure(a.p + (b.p - a.p) * t), angle = Math.atan2(b.y - a.y, b.x - a.x);
    const nx = -Math.sin(angle), ny = Math.cos(angle), dx = Math.cos(angle), dy = Math.sin(angle);
    const radius = stroke.width * (.78 + .22 * p) / 2;
    for (let lane = 0; lane < lanes; lane++) {
      if (random() > .5 + Math.sqrt(p) * .45) continue;
      const laneWidth = radius * 2 / lanes;
      const grain = laneWidth * (.4 + random() * .3), long = step * (.45 + random() * .3);
      const offset = -radius + laneWidth * (lane + .5 + (random() - .5) * .65);
      const along = (random() - .5) * step * .65;
      const x = a.x + (b.x - a.x) * t + nx * offset + dx * along, y = a.y + (b.y - a.y) * t + ny * offset + dy * along;
      layers[1 + Math.min(3, Math.floor(p * 2.5 + random() * 1.5))].polygons.push([
        { x: x - dx * long - nx * grain, y: y - dy * long - ny * grain },
        { x: x - dx * long * .8 + nx * grain, y: y - dy * long * .8 + ny * grain },
        { x: x + dx * long + nx * grain * .7, y: y + dy * long + ny * grain * .7 },
        { x: x + dx * long * .8 - nx * grain, y: y + dy * long * .8 - ny * grain }
      ]);
    }
  }
  return layers.filter(layer => layer.polygons.length);
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
