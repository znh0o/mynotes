import { expect, it } from 'vitest';
import { PalmRejection } from '../src/engine/PalmRejection';

it('rejects broad palm contacts without a pen and preserves normal fingers', () => {
  const guard = new PalmRejection(() => 5000);
  expect(guard.rejectTouch({ pointerType: 'touch', width: 8, height: 10 })).toBe(false);
  expect(guard.rejectTouch({ pointerType: 'touch', width: 31, height: 10 })).toBe(true);
  expect(guard.rejectTouch({ pointerType: 'touch', width: 25, height: 25 })).toBe(true);
  expect(guard.rejectTouch({ pointerType: 'mouse', width: 40, height: 40 })).toBe(false);
});

it('blocks touch near the pen and throughout a stationary pen stroke', () => {
  let now = 1000;
  const guard = new PalmRejection(() => now);
  const finger = { pointerType: 'touch', width: 1, height: 1 };
  const pen = { pointerType: 'pen', pointerId: 7, width: 1, height: 1, buttons: 0, pressure: 0, type: 'pointermove' };
  guard.notePen(pen);
  expect(guard.rejectTouch(finger)).toBe(true);
  now += 801;
  expect(guard.rejectTouch(finger)).toBe(false);
  guard.notePen({ ...pen, type: 'pointerdown', buttons: 1, pressure: .4 });
  now += 5000;
  expect(guard.rejectTouch(finger)).toBe(true);
  guard.notePen({ ...pen, type: 'pointerup' });
  now += 801;
  expect(guard.rejectTouch(finger)).toBe(false);
});
