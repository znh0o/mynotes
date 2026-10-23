import { expect, it } from 'vitest';
import { penContact, penEraser } from '../src/engine/pen-input';

it('recognizes barrel-only, barrel plus tip and inverted eraser combinations', () => {
  for (const buttons of [2, 3, 32, 33]) expect(penEraser({ pointerType: 'pen', buttons })).toBe(true);
  for (const buttons of [0, 1]) expect(penEraser({ pointerType: 'pen', buttons })).toBe(false);
  expect(penEraser({ pointerType: 'mouse', buttons: 2 })).toBe(false);
});
it('ignores a held barrel while hovering and recognizes contact without the tip bit', () => {
  expect(penContact({ buttons: 2, pressure: 0 })).toBe(false);
  expect(penContact({ buttons: 2, pressure: .1 })).toBe(true);
  expect(penContact({ buttons: 32, pressure: .1 })).toBe(true);
  expect(penContact({ buttons: 1, pressure: 0 })).toBe(true);
});
