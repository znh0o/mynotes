import { describe, expect, it } from 'vitest';
import { mergeRestoredPens, restoredSettings } from '../src/data/backup-settings';
const pen = (color: string) => ({ id: 'same-id', name: '내 볼펜', tool: 'pen', color, width: 3, pencilDarkness: .7, pencilAdjustment: 'width' });

describe('PWA to Android settings migration', () => {
  it('remaps document settings and leaves obsolete bookshelf and unrelated settings behind', () => {
    const imported = restoredSettings([
      { key: 'note-palette:old-note', value: ['#3344aa'] },
      { key: 'note-brush:old-note:pen', value: { color: '#3344aa', width: 4 } },
      { key: 'note-palette:missing-note', value: ['#ffffff'] },
      { key: 'study-timer-state:old-note', value: { name: '공부', remaining: 120 } },
      { key: 'study-timer-state:missing-note', value: { name: '다른 노트' } },
      { key: 'study-timer-presets', value: [{ id: 'one', name: '공용', seconds: 120 }] },
      { key: 'bookshelf-arrangement', value: 'custom' },
      { key: 'user-profile', value: { name: '이름' } },
    ], new Set(['old-note']), new Map([['old-note', 'new-note']]));
    expect(imported.map(row => row.key)).toEqual(['note-palette:new-note', 'note-brush:new-note:pen', 'study-timer-state:new-note', 'study-timer-presets', 'user-profile']);
    expect(restoredSettings(undefined, new Set(), new Map())).toEqual([]);
  });
  it('keeps both pens when IDs collide and selects the restored pen without duplicating it on a later restore', () => {
    const current = { selectedId: 'same-id', presets: [pen('#112233')] };
    const incoming = { selectedId: 'same-id', presets: [pen('#aa3344')] };
    const merged = mergeRestoredPens(current, incoming);
    expect(merged.presets.map(item => item.color)).toEqual(['#112233', '#aa3344']);
    expect(merged.selectedId).not.toBe('same-id');
    expect(mergeRestoredPens(merged, incoming)).toEqual(merged);
    expect(current.presets).toEqual([pen('#112233')]);
  });
});
