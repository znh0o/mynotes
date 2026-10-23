import { expect, it } from 'vitest';
import { penContact, penEraser, primaryHoverPress, SamsungPenToggle } from '../src/engine/pen-input';

it('recognizes barrel-only, barrel plus tip and inverted eraser combinations', () => {
  for (const buttons of [2, 3, 32, 33]) expect(penEraser({ pointerType: 'pen', buttons })).toBe(true);
  for (const buttons of [0, 1]) expect(penEraser({ pointerType: 'pen', buttons })).toBe(false);
  expect(penEraser({ pointerType: 'mouse', buttons: 2 })).toBe(false);
});

it('recognizes the reported Samsung hover transition without treating normal contact or native barrels as it', () => {
  const press = { type: 'pointermove', pointerType: 'pen', button: 0, buttons: 1, pressure: 0 };
  expect(primaryHoverPress(press)).toBe(true);
  for (const change of [{ type: 'pointerdown' }, { type: 'pointerup' }, { pointerType: 'mouse' }, { pressure: .001 }, { buttons: 2 }, { button: -1 }]) {
    expect(primaryHoverPress({ ...press, ...change })).toBe(false);
  }
});

it('Samsung compatibility toggles once per press, requires release and never toggles during a real stroke', () => {
  const input = new SamsungPenToggle(), press = { type: 'pointermove', pointerType: 'pen', pointerId: 7, button: 0, buttons: 1, pressure: 0 };
  expect(input.update(press, false, false)).toBe(false);
  expect(input.update(press, true, true)).toBe(false);
  expect(input.update(press, true, false)).toBe(true);
  expect(input.update(press, true, false)).toBe(false);
  input.update({ ...press, button: -1, buttons: 0 }, true, false);
  expect(input.update(press, true, false)).toBe(true);
  input.update({ ...press, type: 'pointerleave' }, true, false);
  expect(input.update(press, true, false)).toBe(true);
  input.reset(); expect(input.update(press, true, false)).toBe(true);
});
it('ignores a held barrel while hovering and recognizes contact without the tip bit', () => {
  expect(penContact({ buttons: 2, pressure: 0 })).toBe(false);
  expect(penContact({ buttons: 2, pressure: .1 })).toBe(true);
  expect(penContact({ buttons: 32, pressure: .1 })).toBe(true);
  expect(penContact({ buttons: 1, pressure: 0 })).toBe(false);
  expect(penContact({ buttons: 1, pressure: .001 })).toBe(true);
  expect(penContact({ buttons: 1, pressure: .5 })).toBe(true);
  expect(penContact({ buttons: 0, pressure: .5 })).toBe(false);
});
