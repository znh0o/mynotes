import { describe, it, expect } from 'vitest';
import { bounds, erase, inside, transform } from '../src/engine/geometry';
import type { Point, Stroke } from '../src/data/model';
const p = (x: number, y = 0): Point => ({ x, y, p: x / 100, t: x });
const stroke: Stroke = { id: 's', kind: 'stroke', tool: 'pen', width: 2, color: '#30445e', pressure: true, points: [p(0), p(100)] };
describe('editable ink geometry', () => {
  it('erases the entire stroke when a fast eraser crosses a sparse segment', () => {
    expect(erase([stroke], p(50, -20), p(50, 20), 5, false)).toEqual([]);
  });
  it('splits a stroke without losing pressure or the surviving end points', () => {
    const pieces = erase([stroke], p(50, -20), p(50, 20), 5, true) as Stroke[];
    expect(pieces).toHaveLength(2); expect(pieces[0].points[0]).toEqual(p(0));
    expect(pieces[1].points.at(-1)).toEqual(p(100));
    expect(pieces[0].points.at(-1)!.x).toBeLessThan(45);
    expect(pieces[1].points[0].x).toBeGreaterThan(55);
    expect(pieces[0].points.at(-1)!.p).toBeGreaterThan(0);
    expect(pieces[0].id).not.toBe(pieces[1].id);
  });
  it('keeps untouched strokes identical and handles a single point', () => {
    expect(erase([stroke], p(150), p(160), 5, true)[0]).toBe(stroke);
    expect(erase([{ ...stroke, points: [p(50)] }], p(50), p(50), 8, true)).toEqual([]);
  });
  it('reuses untouched pages and invalidates cached erase bounds after moving ink', () => {
    const moved = structuredClone(stroke), items = [moved];
    expect(erase(items, p(250, -20), p(250, 20), 5, false)).toBe(items);
    transform(items, 200, 0);
    expect(erase(items, p(250, -20), p(250, 20), 5, false)).toEqual([]);
    expect(erase([stroke], p(45, 30), p(55, 30), 5, false)).toEqual([stroke]);
  });
  it('transforms both strokes and objects in one coordinate system', () => {
    const s = structuredClone(stroke); transform([s], 10, 20, 2);
    expect(s.points[0]).toEqual({ ...p(0), x: 10, y: 20 });
    expect(s.points[1].x).toBe(210); expect(s.width).toBe(4);
    expect(bounds([s])).toEqual({ x: 10, y: 20, w: 200, h: 0 });
  });
  it('supports lasso polygons and very large stroke sets without argument overflow', () => {
    expect(inside(p(5, 5), [p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(true);
    expect(inside(p(15, 5), [p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(false);
    expect(bounds([{ ...stroke, points: Array.from({ length: 150000 }, (_, n) => p(n)) }]).w).toBe(149999);
  });
});
