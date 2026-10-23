import { expect, it } from 'vitest';
import { brushProfile } from '../src/data/brush-settings';

it('keeps legal brush values and migrates the existing pencil darkness', () => {
  expect(brushProfile('pen', { width: 2.5, color: '#112233' })).toEqual({ width: 2.5, color: '#112233' });
  expect(brushProfile('pencil', undefined, .85)).toMatchObject({ width: 3, pencilDarkness: .85, pencilAdjustment: 'width' });
  expect(brushProfile('pencil', { width: 1.5, color: '#445566', pencilDarkness: .4, pencilAdjustment: 'darkness' }, .85))
    .toEqual({ width: 1.5, color: '#445566', pencilDarkness: .4, pencilAdjustment: 'darkness' });
});

it('recovers invalid persisted preferences without losing valid fields', () => {
  for (const width of [NaN, Infinity, -2, 0, 21, '4']) expect(brushProfile('pen', { width, color: '#112233' })).toEqual({ width: 3, color: '#112233' });
  expect(brushProfile('pencil', { width: 2, color: 'red', pencilDarkness: 3, pencilAdjustment: 'unknown' }, .6))
    .toEqual({ width: 2, color: '#30445e', pencilDarkness: .6, pencilAdjustment: 'width' });
  expect(brushProfile('fountain', null)).toEqual({ width: 3, color: '#30445e' });
});
