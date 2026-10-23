import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createNote } from '../src/data/model';
import { NotesDB, SaveQueue, migrateWelcomeBrand } from '../src/data/store';
let db: NotesDB;
beforeEach(async () => { db = new NotesDB(`test-${crypto.randomUUID()}`); await db.open(); });
afterEach(async () => { await db.delete(); });
describe('durable autosave', () => {
  it('renames only the original starter guide and preserves added ink', async () => {
    const original = createNote('MyNotes 시작 가이드', '#b9cee5', null);
    const customized = createNote('MyNotes 시작 가이드', '#b9cee5', null);
    original.note.thumbnail = 'old-preview'; original.page.thumbnail = 'old-preview';
    original.page.items = [
      { id: 'welcome-title', kind: 'text', x: 72, y: 96, w: 650, h: 60, text: '생각이 머무는 곳, MyNotes', color: '#304f72', size: 34 },
      { id: 'user-ink', kind: 'stroke', tool: 'pen', color: '#30445e', width: 3, pressure: false, points: [{ x: 10, y: 10, p: .5, t: 0 }] }
    ];
    customized.page.items = [{ id: 'welcome-title', kind: 'text', x: 72, y: 96, w: 650, h: 60, text: '내가 고친 제목', color: '#304f72', size: 34 }];
    await db.notes.bulkAdd([original.note, customized.note]); await db.pages.bulkAdd([original.page, customized.page]);
    await migrateWelcomeBrand(db); await migrateWelcomeBrand(db);
    expect((await db.notes.get(original.note.id))?.title).toBe('Notelin 시작 가이드');
    expect((await db.notes.get(original.note.id))?.thumbnail).toBeUndefined();
    const renamedPage = (await db.pages.get(original.page.id))!;
    expect(renamedPage.items[0]).toMatchObject({ text: '생각이 머무는 곳, Notelin' });
    expect(renamedPage.items[1]).toEqual(original.page.items[1]);
    expect(renamedPage.thumbnail).toBeUndefined(); expect(renamedPage.revision).toBe(1);
    expect((await db.notes.get(customized.note.id))?.title).toBe('MyNotes 시작 가이드');
    expect((await db.pages.get(customized.page.id))?.items).toEqual(customized.page.items);
  });
  it('saves text continuation pages and order atomically before later typing', async () => {
    const { note, page } = createNote('flow', '#5482da', null); await db.notes.add(note);
    const next = { ...page, id: 'continued-page', items: [] }; note.pageIds.push(next.id);
    const queue = new SaveQueue(db); const layout = queue.savePages(note, [page, next]);
    const typed = { ...next, revision: 2, items: [{ id: 'body', kind: 'text' as const, x: 48, y: 64, w: 698, h: 50, size: 22, color: '#30445e', text: '한글 본문', textMode: 'document' as const }] };
    const edit = queue.saveImmutable(typed); await Promise.all([layout, edit]); await queue.flush();
    expect((await db.notes.get(note.id))!.pageIds).toEqual([page.id, next.id]);
    expect((await db.pages.get(next.id))!.items).toEqual(typed.items);
  });
  it('retains immutable ink snapshots across appended and replaced item arrays', async () => {
    const { note, page } = createNote('immutable', '#b9cee5', null); await db.notes.add(note);
    const queue = new SaveQueue(db);
    page.items.push({ id: 'first', kind: 'stroke', tool: 'pen', width: 3, color: '#252525', pressure: false, points: [{ x: 10, y: 10, p: .6, t: 1 }] });
    const first = queue.saveImmutable(page);
    page.items.push({ ...page.items[0], id: 'second' }); const second = queue.saveImmutable(page);
    page.items = [];
    await Promise.all([first, second]); await queue.flush();
    expect((await db.pages.get(page.id))!.items.map(item => item.id)).toEqual(['first', 'second']);
  });
  it('captures immutable snapshots and commits them in edit order', async () => {
    const { note, page } = createNote('test', '#b9cee5', null);
    await db.notes.add(note); await db.pages.add(page);
    const statuses: string[] = [], queue = new SaveQueue(db, state => statuses.push(state));
    page.revision = 1; const first = queue.save(page);
    page.revision = 2; const second = queue.save(page);
    page.revision = 99;
    await Promise.all([first, second]); await queue.flush();
    expect((await db.pages.get(page.id))!.revision).toBe(2);
    expect(statuses.at(-1)).toBe('모든 변경사항 저장됨');
    expect(queue.busy).toBe(false);
  });
  it('rolls back a failed transaction and recovers on retry', async () => {
    const { note, page } = createNote('test', '#b9cee5', null); await db.notes.add(note); await db.pages.add(page);
    let fail = true;
    db.pages.hook('updating', () => { if (fail) throw new Error('QuotaExceededError'); });
    const statuses: string[] = [], queue = new SaveQueue(db, value => statuses.push(value));
    page.revision = 5; await expect(queue.save(page)).rejects.toThrow('QuotaExceededError');
    await expect(queue.flush()).rejects.toThrow('QuotaExceededError');
    expect((await db.pages.get(page.id))!.revision).toBe(0);
    expect(statuses.at(-1)).toContain('저장 실패');
    fail = false; await queue.save(page); await queue.flush();
    expect((await db.pages.get(page.id))!.revision).toBe(5);
    expect(statuses.at(-1)).toBe('모든 변경사항 저장됨');
  });
  it('updates cover previews only from the first page', async () => {
    const { note, page } = createNote('test', '#b9cee5', null); note.pageIds.push('second');
    await db.notes.add(note); const queue = new SaveQueue(db);
    await queue.save(page, 'first-preview');
    await queue.save({ ...page, id: 'second' }, 'second-preview');
    expect((await db.notes.get(note.id))!.thumbnail).toBe('first-preview');
  });
});
