import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { NotesDB } from '../src/data/store';
import { loadSharedPens, sharedPensKey } from '../src/data/shared-pens';
import { defaultPenCollection } from '../src/data/pen-presets';
import { brushProfile } from '../src/data/brush-settings';

const db = new NotesDB(`shared-pens-${crypto.randomUUID()}`);
const fallback = () => defaultPenCollection({ pen: brushProfile('pen'), fountain: brushProfile('fountain'), pencil: brushProfile('pencil') });
afterEach(async () => { await db.settings.clear(); });

it('combines legacy pen variants without losing colliding IDs or modifying the source settings', async () => {
  const first = fallback(), second = fallback();
  first.presets[0].color = '#dd3344';
  second.presets[0].color = '#28aa55';
  await db.settings.bulkPut([{ key: 'note-pen-presets:first', value: first }, { key: 'note-pen-presets:second', value: second }]);
  const shared = await loadSharedPens('first', fallback(), db);
  expect(shared.presets).toHaveLength(4);
  expect(new Set(shared.presets.map(p => p.id)).size).toBe(4);
  expect(shared.presets.map(p => p.color)).toEqual(expect.arrayContaining(['#dd3344', '#28aa55']));
  expect((await db.settings.get('note-pen-presets:first'))?.value).toEqual(first);
  expect((await db.settings.get('note-pen-presets:second'))?.value).toEqual(second);
  expect(await loadSharedPens('second', fallback(), db)).toEqual(shared);
});

it('uses the common saved list after a later edit instead of restoring older document presets', async () => {
  const shared = await loadSharedPens('first', fallback(), db);
  shared.presets[0].name = '공용 빨간 볼펜'; shared.presets[0].color = '#dd3344'; shared.presets[0].width = 4.5;
  await db.settings.put({ key: sharedPensKey, value: shared });
  await db.settings.put({ key: 'note-pen-presets:second', value: fallback() });
  expect(await loadSharedPens('second', fallback(), db)).toEqual(shared);
});
