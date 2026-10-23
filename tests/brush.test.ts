import { describe, expect, it } from 'vitest';
import { brushLayers } from '../src/engine/brush';
import { graphiteMaterial, graphiteOffset } from '../src/engine/graphite';
import type { Stroke } from '../src/data/model';
const pencil: Stroke = { id: 'graphite', kind: 'stroke', tool: 'pencil', color: '#30445e', width: 8, pressure: true, brushVersion: 2, textureSeed: 42, points: [{ x: 20, y: 50, p: .2, t: 0 }, { x: 180, y: 50, p: .9, t: 10 }] };
describe('versioned brush geometry', () => {
  it('keeps graphite deterministic across serialization and duplicated IDs', () => {
    const layers = brushLayers(pencil);
    expect(layers.length).toBeGreaterThan(0);
    expect(brushLayers({ ...JSON.parse(JSON.stringify(pencil)), id: 'restored-id' })).toEqual(layers);
    expect(graphiteOffset(43)).not.toEqual(graphiteOffset(42));
    expect(graphiteOffset(JSON.parse(JSON.stringify(pencil)).textureSeed)).toEqual(graphiteOffset(42));
  });
  it('renders dots and coincident points without invalid coordinates', () => {
    for (const tool of ['fountain', 'pencil'] as const) for (const points of [[pencil.points[0]], [pencil.points[0], pencil.points[0]]]) {
      const layers = brushLayers({ ...pencil, tool, points });
      expect(layers.length).toBeGreaterThan(0);
      expect(layers.flatMap(l => l.polygons.flat()).every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    }
  });
  it('reuses a fixed paper material instead of allocating grains along the entire stroke', () => {
    const material = structuredClone(graphiteMaterial());
    const short = brushLayers(pencil), long = brushLayers({ ...pencil, points: [pencil.points[0], { ...pencil.points[1], x: 150000 }] });
    expect(long.flatMap(layer => layer.polygons).length).toBe(short.flatMap(layer => layer.polygons).length);
    expect(graphiteMaterial()).toEqual(material);
    expect(material.some(layer => layer.opacity > .9)).toBe(true);
  });
  it('adds pressure density without a uniform opaque pencil undercoat', () => {
    const light = brushLayers({ ...pencil, points: pencil.points.map(p => ({ ...p, p: .1 })) });
    const heavy = brushLayers({ ...pencil, points: pencil.points.map(p => ({ ...p, p: .9 })) });
    expect(heavy[0].opacity).toBeGreaterThan(light[0].opacity * 2);
  });
});
