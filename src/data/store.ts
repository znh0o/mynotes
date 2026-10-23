import Dexie, { type Table } from 'dexie';
import { createNote, type Asset, type Folder, type Note, type Page } from './model';

export class NotesDB extends Dexie {
  notes!: Table<Note, string>;
  pages!: Table<Page, string>;
  folders!: Table<Folder, string>;
  assets!: Table<Asset, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  constructor(name = 'mynotes-v1') {
    super(name);
    this.version(1).stores({
      notes: 'id, folderId, updated, opened, deleted', pages: 'id, noteId',
      folders: 'id', assets: 'id, noteId', settings: 'key'
    });
  }
}
export const db = new NotesDB();

// Snapshot at enqueue time and serialize writes. A later edit can never be
// overwritten by an older, slower IndexedDB transaction.
export class SaveQueue {
  private tail = Promise.resolve();
  private failed: unknown = null;
  private pending = 0;
  constructor(private database: NotesDB = db, private status: (state: string) => void = () => {}) {}
  save(page: Page, thumbnail?: string) {
    return this.enqueue(structuredClone(page), thumbnail);
  }
  // InkEngine treats completed items as immutable and clones only objects being
  // transformed. Retain those items without copying every historical point.
  saveImmutable(page: Page, thumbnail?: string) {
    return this.enqueue({ ...page, items: page.items.slice() }, thumbnail);
  }
  private enqueue(snapshot: Page, thumbnail?: string) {
    this.pending++;
    this.status('저장 중…');
    const task = this.tail.then(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      await this.database.transaction('rw', this.database.pages, this.database.notes, async () => {
        await this.database.pages.put(snapshot);
        const note = await this.database.notes.get(snapshot.noteId);
        if (note) await this.database.notes.update(note.id, {
          updated: Date.now(), ...(note.pageIds[0] === snapshot.id ? { thumbnail: thumbnail ?? snapshot.thumbnail } : {})
        });
      });
      this.failed = null;
    });
    this.tail = task.catch(error => { this.failed = error; }).finally(() => {
      this.pending--;
      if (this.failed) this.status('저장 실패 · 백업이 필요해요');
      else if (!this.pending) this.status('모든 변경사항 저장됨');
    });
    return task;
  }
  async flush() { await this.tail; if (this.failed) throw this.failed; }
  get busy() { return this.pending > 0; }
}

export async function initialize() {
  await db.open();
  await db.transaction('rw', db.notes, db.pages, db.settings, async () => {
    if (await db.settings.get('initialized')) return;
    const { note, page } = createNote('MyNotes 시작 가이드', '#b9cee5', null, { paper: 'dots' });
    page.items = [
      { id: 'welcome-title', kind: 'text', x: 72, y: 96, w: 650, h: 60, text: '생각이 머무는 곳, MyNotes', color: '#304f72', size: 34 },
      { id: 'welcome-sub', kind: 'text', x: 74, y: 176, w: 650, h: 72, text: '한 획의 생각이, 나만의 지식이 되도록.\n이 페이지에 자유롭게 필기해 보세요.', color: '#63758a', size: 20 },
      { id: 'welcome-body', kind: 'text', x: 74, y: 324, w: 650, h: 290, text: '01   펜을 고르고, 첫 문장을 써보세요.\n\n02   손가락으로 이동하고, 두 손가락으로 확대해요.\n\n03   페이지 옆 + 버튼으로 생각을 이어가세요.\n\n04   모든 필기는 이 기기에 자동 저장돼요.\n\n05   설정에서 주기적으로 백업 파일을 보관하세요.', color: '#44566c', size: 21 },
      { id: 'welcome-line', kind: 'stroke', tool: 'highlighter', color: '#c5d8f5', width: 18, pressure: false,
        points: [{ x: 74, y: 270, p: .5, t: 0 }, { x: 435, y: 270, p: .5, t: 1 }] }
    ];
    await db.notes.add(note); await db.pages.add(page);
    await db.settings.put({ key: 'initialized', value: true });
  });
}

export async function persistNew(note: Note, pages: Page[], assets: Asset[] = []) {
  await db.transaction('rw', db.notes, db.pages, db.assets, async () => {
    await db.notes.add(note); await db.pages.bulkAdd(pages); await db.assets.bulkAdd(assets);
  });
}
export async function deletePermanently(note: Note) {
  await db.transaction('rw', db.notes, db.pages, db.assets, async () => {
    await db.pages.where('noteId').equals(note.id).delete();
    await db.assets.where('noteId').equals(note.id).delete();
    await db.notes.delete(note.id);
  });
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function blobData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
}
export async function backup() {
  const data = await db.transaction('r', db.tables, async () => ({
    format: 'mynotes', version: 1,
    notes: await db.notes.toArray(), pages: await db.pages.toArray(),
    folders: await db.folders.toArray(), assets: await db.assets.toArray()
  }));
  const assets = await Promise.all(data.assets.map(async a => ({ ...a, blob: await blobData(a.blob) })));
  download(new Blob([JSON.stringify({ ...data, assets })], { type: 'application/json' }), `MyNotes-backup-${new Date().toISOString().slice(0, 10)}.json`);
}
export async function restore(file: File) {
  if (file.size > 400 * 1024 * 1024) throw new Error('백업 파일은 400MB 이하로 복원할 수 있어요.');
  const input = JSON.parse(await file.text());
  if (input.format !== 'mynotes' || input.version !== 1 || !Array.isArray(input.notes) || !Array.isArray(input.pages) || !Array.isArray(input.assets) || !Array.isArray(input.folders)) throw new Error('MyNotes 백업 파일이 아니에요.');
  const ids = new Map<string, string>();
  const remap = (old: string) => { if (typeof old !== 'string') throw new Error('올바르지 않은 ID'); if (!ids.has(old)) ids.set(old, crypto.randomUUID()); return ids.get(old)!; };
  const assets: Asset[] = [];
  for (const a of input.assets) {
    if (typeof a.blob !== 'string' || !/^data:(application\/pdf|image\/(png|jpeg|webp));base64,/.test(a.blob)) throw new Error('지원하지 않는 백업 첨부파일');
    assets.push({ id: remap(a.id), noteId: remap(a.noteId), name: String(a.name), blob: await (await fetch(a.blob)).blob() });
  }
  const color = (v: unknown) => { if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error('잘못된 색상 데이터'); return v; };
  const preview = (v: unknown) => typeof v === 'string' && /^data:image\/(webp|png|jpeg);base64,[a-z0-9+/=]+$/i.test(v) ? v : undefined;
  const finite = (v: unknown, limit = 10000000) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
  const folders: Folder[] = input.folders.map((f: Folder) => ({ id: remap(f.id), name: String(f.name).slice(0, 60), color: color(f.color) }));
  const notes: Note[] = input.notes.map((n: Note) => {
    if (!Array.isArray(n.pageIds) || typeof n.title !== 'string') throw new Error('손상된 노트');
    if (![n.created, n.updated, n.opened].every(v => finite(v, 1e15))) throw new Error('손상된 노트 날짜');
    return { ...n, id: remap(n.id), title: `${n.title.slice(0, 100)} (복원)`, cover: color(n.cover), thumbnail: preview(n.thumbnail), folderId: n.folderId ? remap(n.folderId) : null, pageIds: n.pageIds.map(remap) };
  });
  const noteIds = new Set(input.notes.map((n: Note) => n.id));
  const pageIds = new Set(input.pages.map((p: Page) => p.id));
  const assetIds = new Set(input.assets.map((a: Asset) => a.id));
  for (const n of input.notes) if (n.pageIds.some((id: string) => !pageIds.has(id))) throw new Error('누락된 페이지');
  const pages: Page[] = input.pages.map((p: Page) => {
    if (!noteIds.has(p.noteId) || !Array.isArray(p.items) || !Number.isFinite(p.width) || !Number.isFinite(p.height) || p.width < 100 || p.height < 100 || p.width > 5000 || p.height > 5000) throw new Error('손상된 페이지');
    if (p.pdfAssetId && !assetIds.has(p.pdfAssetId)) throw new Error('누락된 PDF');
    if (!['blank', 'lined', 'grid', 'dots', 'cornell', 'planner'].includes(p.paper) || !finite(p.spacing, 80) || p.spacing < 12 || !Number.isSafeInteger(p.revision) || p.revision < 0) throw new Error('손상된 속지');
    color(p.paperColor);
    if (p.pdfAssetId && (!Number.isSafeInteger(p.pdfIndex) || p.pdfIndex! < 1)) throw new Error('잘못된 PDF 페이지 번호');
    for (const i of p.items) {
      if (!['stroke', 'text', 'shape', 'image'].includes(i.kind)) throw new Error('알 수 없는 필기 데이터');
      if (i.kind === 'stroke' && (!Array.isArray(i.points) || i.points.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.p)))) throw new Error('손상된 획');
      if (i.kind === 'image' && !assetIds.has(i.assetId)) throw new Error('누락된 이미지');
      if (i.kind !== 'image') color(i.color);
      if (i.kind === 'stroke' && (!['pen', 'fountain', 'pencil', 'highlighter'].includes(i.tool) || !finite(i.width, 1000) || i.width <= 0 || i.points.some(v => !finite(v.x) || !finite(v.y) || !finite(v.p, 1) || !finite(v.t, 1e15)))) throw new Error('잘못된 펜 데이터');
      if (i.kind === 'stroke' && (i.brushVersion !== undefined && i.brushVersion !== 2 || i.textureSeed !== undefined && (!Number.isSafeInteger(i.textureSeed) || i.textureSeed < 0 || i.textureSeed > 0xffffffff))) throw new Error('잘못된 펜 질감 데이터');
      if (i.kind !== 'stroke' && ![i.x, i.y, i.w, i.h].every(v => finite(v))) throw new Error('잘못된 오브젝트 좌표');
      if (i.kind === 'text' && (typeof i.text !== 'string' || !finite(i.size, 1000) || i.size <= 0)) throw new Error('잘못된 텍스트');
      if (i.kind === 'shape' && (!['line', 'rect', 'ellipse', 'triangle'].includes(i.shape) || !finite(i.width, 1000) || i.width <= 0)) throw new Error('잘못된 도형');
    }
    return { ...p, id: remap(p.id), noteId: remap(p.noteId), thumbnail: preview(p.thumbnail), pdfAssetId: p.pdfAssetId ? remap(p.pdfAssetId) : undefined,
      items: p.items.map(i => ({ ...i, id: remap(i.id), ...(i.kind === 'image' ? { assetId: remap(i.assetId) } : {}) })) };
  });
  await db.transaction('rw', db.notes, db.pages, db.folders, db.assets, async () => {
    await db.folders.bulkAdd(folders); await db.notes.bulkAdd(notes); await db.pages.bulkAdd(pages); await db.assets.bulkAdd(assets);
  });
}
