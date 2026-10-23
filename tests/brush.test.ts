import { describe, expect, it } from 'vitest';
import { brushLayers } from '../src/engine/brush';
import type { Stroke } from '../src/data/model';
const pencil: Stroke = { id: 'graphite', kind: 'stroke', tool: 'pencil', color: '#30445e', width: 8, pressure: true, brushVersion: 2, textureSeed: 42, points: [{ x: 20, y: 50, p: .2, t: 0 }, { x: 180, y: 50, p: .9, t: 10 }] };
describe('versioned brush geometry', () => {
  it('keeps graphite deterministic across serialization and duplicated IDs', () => {
    const layers = brushLayers(pencil);
    expect(layers.length).toBeGreaterThan(1);
    expect(brushLayers({ ...JSON.parse(JSON.stringify(pencil)), id: 'restored-id' })).toEqual(layers);
    expect(brushLayers({ ...pencil, textureSeed: 43 })).not.toEqual(layers);
  });
  it('renders dots and coincident points without invalid coordinates', () => {
    for (const tool of ['fountain', 'pencil'] as const) for (const points of [[pencil.points[0]], [pencil.points[0], pencil.points[0]]]) {
      const layers = brushLayers({ ...pencil, tool, points });
      expect(layers.length).toBeGreaterThan(0);
      expect(layers.flatMap(l => l.polygons.flat()).every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    }
  });
  it('keeps existing graphite grains in place while extending a live stroke', () => {
    const points = [20, 180, 1500].map(x => ({ x, y: 50, p: .65, t: x }));
    const grains = (count: number) => brushLayers({ ...pencil, points: points.slice(0, count) }).flatMap(layer => layer.polygons.filter(polygon => polygon.length === 4 && polygon.every(p => p.x < 150))).map(polygon => polygon.map(p => [p.x.toFixed(3), p.y.toFixed(3)]));
    expect(grains(3)).toEqual(grains(2));
  });
});
