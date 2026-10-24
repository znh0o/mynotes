import { db as appDb } from './store';
import { uid } from './model';
import { penCollection, type PenCollection, type PenPreset } from './pen-presets';

export const sharedPensKey = 'pen-presets';

// Keep legacy document collections intact while combining their saved pens once.
export async function loadSharedPens(noteId: string, fallback: PenCollection, database = appDb): Promise<PenCollection> {
  const db = database;
  return db.transaction('rw', db.settings, async () => {
    const shared = await db.settings.get(sharedPensKey);
    if (shared) return penCollection(shared.value, fallback);
    const legacy = await db.settings.where('key').startsWith('note-pen-presets:').toArray();
    legacy.sort((a, b) => Number(b.key === `note-pen-presets:${noteId}`) - Number(a.key === `note-pen-presets:${noteId}`));
    const presets: PenPreset[] = [], signatures = new Set<string>(), ids = new Set<string>();
    let selectedId = '';
    for (const row of legacy) {
      const collection = penCollection(row.value, { selectedId: '', presets: [] });
      for (const pen of collection.presets) {
        const { id: _id, ...style } = pen;
        const signature = JSON.stringify(style);
        if (signatures.has(signature)) continue;
        const id = ids.has(pen.id) ? uid() : pen.id;
        presets.push({ ...pen, id }); ids.add(id); signatures.add(signature);
        if (!selectedId && collection.selectedId === pen.id) selectedId = id;
      }
    }
    const collection = presets.length ? { selectedId: selectedId || presets[0].id, presets } : fallback;
    await db.settings.put({ key: sharedPensKey, value: collection });
    return collection;
  });
}
