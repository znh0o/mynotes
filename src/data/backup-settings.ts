import { penCollection, type PenCollection } from './pen-presets';
import { uid } from './model';

type Setting = { key: string; value: unknown };
const globals = new Set(['eraser-settings', 'two-page-view', 'hold-to-line', 'samsung-pen-button-toggle', 'library-columns', 'user-profile', 'study-timer-presets', 'study-timer-state']);
const emptyPens = (): PenCollection => ({ selectedId: '', presets: [] });

export function restoredSettings(input: unknown, noteIds: Set<string>, remapped: Map<string, string>): Setting[] {
  if (!Array.isArray(input)) return [];
  const result: Setting[] = [];
  for (const row of input) {
    if (!row || typeof row.key !== 'string' || row.key.length > 200) continue;
    if (row.key === 'pen-presets') {
      const value = penCollection(row.value, emptyPens());
      if (value.presets.length) result.push({ key: row.key, value });
    } else if (globals.has(row.key)) result.push({ key: row.key, value: row.value });
    else {
      const match = /^(note-brush|note-palette|note-shape|study-timer-state):([^:]+)(:.*)?$/.exec(row.key);
      if (match && noteIds.has(match[2]) && remapped.has(match[2])) result.push({ key: `${match[1]}:${remapped.get(match[2])}${match[3] || ''}`, value: row.value });
    }
  }
  return result;
}

// Keep existing saved pens when restoring into an already-used APK. Conflicting
// preset IDs get fresh IDs so a restored pen never overwrites another pen.
export function mergeRestoredPens(current: unknown, incoming: unknown): PenCollection {
  const existing = penCollection(current, emptyPens()), restored = penCollection(incoming, emptyPens());
  const presets = [...existing.presets];
  const identity = (pen: PenCollection['presets'][number]) => JSON.stringify([pen.name, pen.tool, pen.color.toLowerCase(), pen.width, pen.pencilDarkness, pen.pencilAdjustment]);
  let selectedId = existing.selectedId;
  for (const pen of restored.presets) {
    let saved = presets.find(item => identity(item) === identity(pen));
    if (!saved) {
      saved = { ...pen, id: presets.some(item => item.id === pen.id) ? uid() : pen.id };
      presets.push(saved);
    }
    if (pen.id === restored.selectedId) selectedId = saved.id;
  }
  return { selectedId, presets };
}
