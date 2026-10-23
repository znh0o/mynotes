import { describe, it, expect } from 'vitest';
import { canStraighten, straightPoints } from '../src/engine/straight-line';
import type { Point } from '../src/data/model';

const points = Array.from({ length: 30 }, (_, i): Point => ({ x: 30 + i * 6, y: 90 + i + Math.sin(i / 3) * 4, p: .2 + i / 50, t: i * 10 }));
describe('hold to straighten', () => {
  it('recognizes a roughly straight stroke but leaves dots and closed writing alone', () => {
    expect(canStraighten(points)).toBe(true);
    expect(canStraighten(points.slice(0, 2))).toBe(false);
    expect(canStraighten([...points, points[0]])).toBe(false);
    expect(canStraighten([{...points[0]}, { ...points[0], x: 30, y: 400 }, points.at(-1)!])).toBe(false);
  });
  it('keeps the start, pressure samples and editable endpoint on one line', () => {
    const end = { x: 300, y: 180, p: .8, t: 500 }, line = straightPoints(points, end);
    expect(line[0]).toEqual(points[0]);
    expect(line.at(-1)).toEqual({ ...end, p: points.at(-1)!.p });
    expect(line.every(p => Math.abs((p.x - line[0].x) * (end.y - line[0].y) - (p.y - line[0].y) * (end.x - line[0].x)) < 1e-8)).toBe(true);
  });
});
