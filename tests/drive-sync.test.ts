import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  driveAccount: vi.fn(async () => ({ token: 'token', email: 'student@example.com', accountId: 'account-one' })),
  listDriveFiles: vi.fn(async () => [] as { id: string; name: string; appProperties?: Record<string, string> }[]),
  putDriveFile: vi.fn(async (_token: string, name: string) => ({ id: 'generated-file-id', name })),
  downloadDriveFile: vi.fn(async (_token: string, _file: { id: string }) => new Blob()),
  deleteDriveFile: vi.fn(async () => {}),
}));
vi.mock('../src/data/google-drive', () => transport);

import { db } from '../src/data/store';
import { createNote, uid } from '../src/data/model';
import { syncDrive } from '../src/data/drive-sync';

beforeEach(async () => {
  vi.clearAllMocks();
  transport.driveAccount.mockResolvedValue({ token: 'token', email: 'student@example.com', accountId: 'account-one' });
  transport.listDriveFiles.mockResolvedValue([]);
  transport.putDriveFile.mockImplementation(async (_token, name) => ({ id: 'generated-file-id', name }));
  transport.downloadDriveFile.mockResolvedValue(new Blob());
  await db.open();
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
});

describe('Drive note sync safety', () => {
  it('uploads local notes with stable IDs and remembers the account only after success', async () => {
    const { note, page } = createNote('수학', '#5482da', null);
    await db.notes.put(note); await db.pages.put(page);
    const result = await syncDrive();
    expect(result.uploaded).toBe(1);
    expect(transport.putDriveFile.mock.calls.some(call => call[1] === `notelin-v1-note-${note.id}.json`)).toBe(true);
    expect((await db.notes.toArray()).map(item => item.id)).toEqual([note.id]);
    expect((await db.settings.get('drive-sync-enabled'))?.value).toMatchObject({ accountId: 'account-one' });
  });

  it('keeps both versions when a remote note with the same ID was edited independently', async () => {
    const { note, page } = createNote('국어', '#5482da', null);
    await db.notes.put(note); await db.pages.put(page);
    const remoteNote = { ...note, title: '국어 다른 기기' };
    const remote = JSON.stringify({ format: 'notelin-note-v1', note: { ...remoteNote, opened: 0 }, pages: [page], assets: [], settings: [] });
    transport.listDriveFiles.mockResolvedValueOnce([{ id: 'remote-file', name: `notelin-v1-note-${note.id}.json` }]);
    transport.downloadDriveFile.mockImplementation(async () => new Blob([remote], { type: 'application/json' }));
    const result = await syncDrive();
    const notes = await db.notes.toArray();
    expect(result.conflicts).toBe(1);
    expect(notes).toHaveLength(2);
    expect(notes.find(item => item.id === note.id)?.title).toBe('국어');
    expect(notes.some(item => item.title.includes('충돌 사본'))).toBe(true);
    expect(await db.pages.count()).toBe(2);
  });

  it('does not create another conflict copy after an interrupted upload', async () => {
    const { note, page } = createNote('과학', '#5482da', null);
    await db.notes.put(note); await db.pages.put(page);
    const remote = JSON.stringify({ format: 'notelin-note-v1', note: { ...note, title: '과학 다른 기기', opened: 0 }, pages: [page], assets: [], settings: [] });
    transport.listDriveFiles.mockResolvedValue([{ id: 'remote-file', name: `notelin-v1-note-${note.id}.json` }]);
    transport.downloadDriveFile.mockResolvedValue(new Blob([remote], { type: 'application/json' }));
    let failOnce = true;
    transport.putDriveFile.mockImplementation(async (_token, name) => {
      if (name === `notelin-v1-note-${note.id}.json` && failOnce) { failOnce = false; throw new Error('network failed'); }
      return { id: 'generated-file-id', name };
    });
    await expect(syncDrive()).rejects.toThrow('network failed');
    expect(await db.notes.count()).toBe(2);
    await syncDrive();
    expect(await db.notes.count()).toBe(2);
  });

  it('imports a note from another device without changing its ID', async () => {
    const { note, page } = createNote('영어', '#5482da', null);
    const remote = JSON.stringify({ format: 'notelin-note-v1', note: { ...note, opened: 0 }, pages: [page], assets: [], settings: [{ key: `note-text-color:${note.id}`, value: '#112233' }] });
    transport.listDriveFiles.mockResolvedValueOnce([{ id: 'remote-file', name: `notelin-v1-note-${note.id}.json` }]);
    transport.downloadDriveFile.mockResolvedValue(new Blob([remote], { type: 'application/json' }));
    const result = await syncDrive();
    expect(result.downloaded).toBe(1);
    expect((await db.notes.get(note.id))?.title).toBe('영어');
    expect((await db.pages.get(page.id))?.noteId).toBe(note.id);
    expect((await db.settings.get(`note-text-color:${note.id}`))?.value).toBe('#112233');
  });

  it('moves an unchanged local note to trash when the cloud note is gone', async () => {
    const { note, page } = createNote('사회', '#5482da', null);
    await db.notes.put(note); await db.pages.put(page);
    await syncDrive();
    const result = await syncDrive();
    expect(result.trashed).toBe(1);
    expect((await db.notes.get(note.id))?.deleted).toEqual(expect.any(Number));
    expect(await db.pages.get(page.id)).toBeDefined();
  });

  it('uploads a PDF asset before publishing the note that refers to it', async () => {
    const { note, page } = createNote('PDF 필기', '#5482da', null);
    const assetId = uid(); page.pdfAssetId = assetId; page.pdfIndex = 1;
    await db.notes.put(note); await db.pages.put(page);
    await db.assets.put({ id: assetId, noteId: note.id, name: '수업.pdf', blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }) });
    await syncDrive();
    const names = transport.putDriveFile.mock.calls.map(call => call[1]);
    expect(names.indexOf(`notelin-v1-asset-${assetId}`)).toBeGreaterThanOrEqual(0);
    expect(names.indexOf(`notelin-v1-asset-${assetId}`)).toBeLessThan(names.indexOf(`notelin-v1-note-${note.id}.json`));
  });

  it('downloads a remote PDF and its note together', async () => {
    const { note, page } = createNote('원격 PDF', '#5482da', null);
    const assetId = uid(); page.pdfAssetId = assetId; page.pdfIndex = 1;
    const content = JSON.stringify({ format: 'notelin-note-v1', note: { ...note, opened: 0 }, pages: [page], assets: [{ id: assetId, name: '수업.pdf', type: 'application/pdf' }], settings: [] });
    transport.listDriveFiles.mockResolvedValueOnce([
      { id: 'remote-note', name: `notelin-v1-note-${note.id}.json` },
      { id: 'remote-asset', name: `notelin-v1-asset-${assetId}` },
    ]);
    transport.downloadDriveFile.mockImplementation(async (_token, file) => new Blob([file.id === 'remote-asset' ? '%PDF-1.7' : content]));
    await syncDrive();
    expect((await db.assets.get(assetId))?.noteId).toBe(note.id);
    expect((await db.assets.get(assetId))?.blob.type).toBe('application/pdf');
    expect((await db.pages.get(page.id))?.pdfAssetId).toBe(assetId);
  });
});
