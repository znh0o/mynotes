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
  it('fixes new pencil width and darkness independently of pressure', () => {
    const fixed = { ...pencil, pressure: false, pencilDarkness: .7 };
    const light = brushLayers({ ...fixed, points: fixed.points.map(p => ({ ...p, p: .1 })) });
    const heavy = brushLayers({ ...fixed, points: fixed.points.map(p => ({ ...p, p: .9 })) });
    expect(light).toEqual(heavy);
    const darker = brushLayers({ ...fixed, pencilDarkness: .9 });
    expect(darker[0].polygons).toEqual(light[0].polygons);
    expect(darker[0].opacity).toBe(.9);
  });
  it('keeps a continuous base under visible, connected graphite deposits', () => {
    const [base, ...grains] = graphiteMaterial();
    expect(base.opacity).toBeGreaterThanOrEqual(.5);
    const contrast = (1 - base.opacity) * Math.max(...grains.map(layer => layer.opacity));
    expect(contrast).toBeGreaterThan(.4); expect(contrast).toBeLessThanOrEqual(.5);
    expect(grains.flatMap(layer => layer.polygons).length).toBeLessThan(4096);
  });
});
