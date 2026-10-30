import { db } from './store';
import { uid, type Asset, type Folder, type Note, type Page } from './model';
import { mergeRestoredPens } from './backup-settings';
import { penCollection } from './pen-presets';
import { revokeNativeDrive } from '../platform/native';
import { driveAccount, listDriveFiles, putDriveFile, downloadDriveFile, deleteDriveFile, type DriveFile } from './google-drive';

const notePrefix = 'notelin-v1-note-';
const assetPrefix = 'notelin-v1-asset-';
const folderFile = 'notelin-v1-folders.json';
const sharedFile = 'notelin-v1-shared-settings.json';
const noteFileName = (id: string) => `${notePrefix}${id}.json`;
const assetFileName = (id: string) => `${assetPrefix}${id}`;
const noteSetting = (key: string, id: string) => /^(note-brush|note-palette|note-shape|note-text-color|study-timer-state):/.test(key) && (key.endsWith(`:${id}`) || key.includes(`:${id}:`));
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
const color = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const finite = (value: unknown, limit = 1e10) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

interface AssetInfo { id: string; name: string; type: string }
interface NoteBundle {
  format: 'notelin-note-v1'; note: Note; pages: Page[]; assets: AssetInfo[];
  settings: { key: string; value: unknown }[];
}
interface Anchor { notes: Record<string, { hash: string; suppressed?: boolean; conflictHash?: string }>; folders?: string; shared?: string }
export interface DriveSyncResult { email: string; uploaded: number; downloaded: number; conflicts: number; trashed: number }
export class DriveSyncDeferredError extends Error { constructor() { super('필기 화면을 닫은 뒤 동기화를 계속해요.'); } }
const encode = (value: unknown) => JSON.stringify(value);
async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
function sortedFiles(files: DriveFile[]) {
  return new Map(files.sort((a, b) => (a.modifiedTime || '').localeCompare(b.modifiedTime || '')).map(file => [file.name, file]));
}
async function remoteText(token: string, file: DriveFile, maxBytes = 60 * 1024 * 1024) {
  if (Number(file.size || 0) > maxBytes) throw new Error('Drive 노트 파일이 너무 커서 동기화할 수 없어요.');
  const blob = await downloadDriveFile(token, file);
  if (blob.size > maxBytes) throw new Error('Drive 노트 파일이 너무 커서 동기화할 수 없어요.');
  return blob.text();
}
async function remoteHash(token: string, file: DriveFile) {
  const hash = file.appProperties?.sha256;
  return hash && /^[0-9a-f]{64}$/.test(hash) ? hash : sha256(await remoteText(token, file));
}
async function putJson(token: string, name: string, text: string, files: Map<string, DriveFile>) {
  if (text.length > 60 * 1024 * 1024) throw new Error('노트 내용이 너무 커서 동기화할 수 없어요.');
  const hash = await sha256(text);
  const item = await putDriveFile(token, name, new Blob([text], { type: 'application/json' }), files.get(name), hash);
  if (!validId(item.id) && !/^[\w-]+$/.test(item.id || '')) throw new Error('Drive에서 파일 ID를 받지 못했어요.');
  files.set(name, { ...item, name, appProperties: { sha256: hash } });
  return hash;
}
function validateBundle(data: unknown): NoteBundle {
  if (!data || typeof data !== 'object') throw new Error('손상된 Drive 노트 파일이에요.');
  const bundle = data as NoteBundle;
  const note = bundle.note;
  if (bundle.format !== 'notelin-note-v1' || !note || !validId(note.id) || typeof note.title !== 'string' || note.title.length > 200 ||
    !color(note.cover) || !finite(note.created, 1e15) || !finite(note.updated, 1e15) || !finite(note.opened, 1e15) ||
    (note.deleted !== null && !finite(note.deleted, 1e15)) || (note.folderId !== null && !validId(note.folderId)) || typeof note.favorite !== 'boolean' ||
    !Array.isArray(note.pageIds) || note.pageIds.length > 10000 || !Array.isArray(bundle.pages) ||
    !Array.isArray(bundle.assets) || !Array.isArray(bundle.settings) || bundle.settings.length > 100) throw new Error('손상된 Drive 노트 파일이에요.');
  const pageIds = new Set(bundle.pages.map(page => page.id));
  if (pageIds.size !== note.pageIds.length || note.pageIds.some(id => !validId(id) || !pageIds.has(id))) throw new Error('Drive 노트에 페이지가 누락됐어요.');
  const assetIds = new Set(bundle.assets.map(asset => asset.id));
  if (assetIds.size !== bundle.assets.length) throw new Error('Drive 첨부파일 정보가 중복됐어요.');
  for (const asset of bundle.assets) if (!validId(asset.id) || typeof asset.name !== 'string' || asset.name.length > 200 ||
    !/^(application\/pdf|image\/(png|jpeg|webp))$/.test(asset.type)) throw new Error('Drive 첨부파일 정보가 올바르지 않아요.');
  for (const page of bundle.pages) {
    if (page.noteId !== note.id || !finite(page.width, 5000) || page.width < 100 || !finite(page.height, 5000) || page.height < 100 ||
      !['blank', 'lined', 'grid', 'dots', 'cornell', 'planner'].includes(page.paper) || !color(page.paperColor) ||
      !finite(page.spacing, 80) || page.spacing < 12 || !Number.isSafeInteger(page.revision) || page.revision < 0 ||
      !Array.isArray(page.items) || page.items.length > 100000) throw new Error('손상된 Drive 페이지예요.');
    if (page.pdfAssetId && (!assetIds.has(page.pdfAssetId) || !Number.isSafeInteger(page.pdfIndex) || page.pdfIndex! < 1)) throw new Error('Drive PDF 첨부파일이 누락됐어요.');
    for (const item of page.items) {
      if (!item || !['stroke', 'text', 'shape', 'image'].includes(item.kind)) throw new Error('Drive 필기 데이터가 올바르지 않아요.');
      if (item.kind === 'image' && !assetIds.has(item.assetId)) throw new Error('Drive 이미지가 누락됐어요.');
      if (item.kind !== 'image' && !color(item.color)) throw new Error('Drive 필기 색상이 올바르지 않아요.');
      if (item.kind === 'stroke' && (!['pen', 'fountain', 'pencil', 'highlighter'].includes(item.tool) || !Array.isArray(item.points) || item.points.length > 1_000_000 || !finite(item.width, 1000) || item.width <= 0 ||
        item.points.some(p => !finite(p.x) || !finite(p.y) || !finite(p.p, 1) || !finite(p.t, 1e15)))) throw new Error('Drive 필기 획이 손상됐어요.');
      if (item.kind !== 'stroke' && (![item.x, item.y, item.w, item.h].every(v => finite(v)))) throw new Error('Drive 오브젝트가 손상됐어요.');
      if (item.kind === 'text' && (typeof item.text !== 'string' || item.text.length > 1_000_000 || !finite(item.size, 1000) || item.size <= 0)) throw new Error('Drive 텍스트가 손상됐어요.');
      if (item.kind === 'shape' && (!['line', 'rect', 'ellipse', 'triangle'].includes(item.shape) || !finite(item.width, 1000) || item.width <= 0)) throw new Error('Drive 도형이 손상됐어요.');
    }
  }
  if (bundle.settings.some(row => !row || typeof row.key !== 'string' || !noteSetting(row.key, note.id))) throw new Error('Drive 노트 설정이 올바르지 않아요.');
  return bundle;
}
async function localBundle(note: Note): Promise<NoteBundle> {
  return db.transaction('r', db.pages, db.assets, db.settings, async () => {
    const pages = await db.pages.where('noteId').equals(note.id).toArray();
    const assets = await db.assets.where('noteId').equals(note.id).toArray();
    const settings = (await db.settings.toArray()).filter(row => noteSetting(row.key, note.id));
    const order = new Map(note.pageIds.map((id, index) => [id, index]));
    const bundle: NoteBundle = {
      format: 'notelin-note-v1', note: { ...note, opened: 0, thumbnail: undefined },
      pages: pages.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(page => ({ ...page, thumbnail: undefined })),
      assets: assets.sort((a, b) => a.id.localeCompare(b.id)).map(asset => ({ id: asset.id, name: asset.name, type: asset.blob.type })),
      settings: settings.sort((a, b) => a.key.localeCompare(b.key)),
    };
    return validateBundle(bundle);
  });
}
async function readBundle(token: string, file: DriveFile): Promise<{ bundle: NoteBundle; hash: string }> {
  const text = await remoteText(token, file);
  const hash = await sha256(text);
  if (file.appProperties?.sha256 && file.appProperties.sha256 !== hash) throw new Error('Drive 노트의 무결성 확인에 실패했어요.');
  return { bundle: validateBundle(JSON.parse(text)), hash };
}
async function ensureRemoteAssets(token: string, bundle: NoteBundle, files: Map<string, DriveFile>) {
  for (const info of bundle.assets) {
    const name = assetFileName(info.id);
    if (files.has(name)) continue;
    const asset = await db.assets.get(info.id);
    if (!asset || asset.noteId !== bundle.note.id) throw new Error('이 기기에 첨부파일이 없어 Drive로 보낼 수 없어요.');
    const file = await putDriveFile(token, name, asset.blob);
    files.set(name, { ...file, name });
  }
}
async function applyRemote(token: string, bundle: NoteBundle, files: Map<string, DriveFile>, copy = false, canApply: (id: string) => boolean = () => true) {
  const newId = copy ? uid() : bundle.note.id;
  const pageMap = new Map(bundle.pages.map(page => [page.id, copy ? uid() : page.id]));
  const assetMap = new Map(bundle.assets.map(asset => [asset.id, copy ? uid() : asset.id]));
  const assets: Asset[] = [];
  for (const info of bundle.assets) {
    const targetId = assetMap.get(info.id)!;
    if (!copy) {
      const localAsset = await db.assets.get(targetId);
      if (localAsset) {
        if (localAsset.noteId !== newId) throw new Error('Drive 첨부파일 ID가 다른 노트와 충돌했어요.');
        continue;
      }
    }
    const file = files.get(assetFileName(info.id));
    if (!file || Number(file.size || 0) > 150 * 1024 * 1024) throw new Error('Drive 첨부파일이 누락됐거나 너무 커요.');
    const downloaded = await downloadDriveFile(token, file);
    if (downloaded.size > 150 * 1024 * 1024) throw new Error('Drive 첨부파일이 너무 커요.');
    assets.push({ id: targetId, noteId: newId, name: info.name, blob: new Blob([downloaded], { type: info.type }) });
  }
  const existing = copy ? undefined : await db.notes.get(newId);
  const note: Note = { ...bundle.note, id: newId, title: copy ? `${bundle.note.title} (충돌 사본)` : bundle.note.title,
    folderId: bundle.note.folderId, pageIds: bundle.note.pageIds.map(id => pageMap.get(id)!),
    lastPageId: bundle.note.lastPageId ? pageMap.get(bundle.note.lastPageId) : undefined,
    opened: existing?.opened || Date.now(), thumbnail: undefined, temporary: false,
    ...(copy ? { updated: Date.now(), created: Date.now(), deleted: null } : {}) };
  const pages: Page[] = bundle.pages.map(page => ({ ...page, id: pageMap.get(page.id)!, noteId: newId, thumbnail: undefined,
    pdfAssetId: page.pdfAssetId ? assetMap.get(page.pdfAssetId) : undefined,
    items: page.items.map(item => ({ ...item, id: copy ? uid() : item.id,
      ...(item.kind === 'image' ? { assetId: assetMap.get(item.assetId)! } : {}) })) }));
  const settings = bundle.settings.map(row => ({ key: copy ? row.key.replace(`:${bundle.note.id}`, `:${newId}`) : row.key, value: row.value }));
  if (!canApply(bundle.note.id)) throw new DriveSyncDeferredError();
  await db.transaction('rw', db.notes, db.pages, db.assets, db.settings, async () => {
    if (!canApply(bundle.note.id)) throw new DriveSyncDeferredError();
    if (!copy) {
      await db.pages.where('noteId').equals(newId).delete();
      const oldKeys = (await db.settings.toArray()).filter(row => noteSetting(row.key, newId)).map(row => row.key);
      if (oldKeys.length) await db.settings.bulkDelete(oldKeys);
    }
    await db.notes.put(note); await db.pages.bulkPut(pages); await db.assets.bulkPut(assets);
    await db.settings.bulkPut(settings);
  });
}

async function syncFolders(token: string, files: Map<string, DriveFile>, anchor: Anchor) {
  const local = (await db.folders.toArray()).sort((a, b) => a.id.localeCompare(b.id));
  const localText = encode(local), localHash = await sha256(localText), remote = files.get(folderFile);
  if (!remote) { anchor.folders = await putJson(token, folderFile, localText, files); return; }
  const text = await remoteText(token, remote, 1024 * 1024);
  const remoteHashValue = await sha256(text);
  const incoming = JSON.parse(text) as Folder[];
  if (!Array.isArray(incoming) || incoming.some(f => !f || !validId(f.id) || typeof f.name !== 'string' || f.name.length > 60 || !color(f.color))) throw new Error('Drive 폴더 정보가 손상됐어요.');
  if (localHash === remoteHashValue) { anchor.folders = localHash; return; }
  if (localHash === anchor.folders) {
    await db.transaction('rw', db.folders, async () => { await db.folders.clear(); await db.folders.bulkPut(incoming); });
    anchor.folders = remoteHashValue; return;
  }
  const merged = remoteHashValue === anchor.folders ? local : Array.from(new Map([...incoming, ...local].map(f => [f.id, f])).values()).sort((a, b) => a.id.localeCompare(b.id));
  await db.folders.bulkPut(merged);
  anchor.folders = await putJson(token, folderFile, encode(merged), files);
}

type TimerPreset = { id: string; name: string; seconds: number };
function timerPresets(value: unknown): TimerPreset[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TimerPreset => !!item && typeof item.id === 'string' && item.id.length < 100 &&
    typeof item.name === 'string' && item.name.trim().length > 0 && Number.isInteger(item.seconds) && item.seconds > 0 && item.seconds < 86400)
    .slice(0, 50).map(item => ({ id: item.id, name: item.name.slice(0, 40), seconds: item.seconds }));
}
async function syncSharedSettings(token: string, files: Map<string, DriveFile>, anchor: Anchor) {
  const [savedPens, savedTimers] = await Promise.all([db.settings.get('pen-presets'), db.settings.get('study-timer-presets')]);
  const local = { pens: penCollection(savedPens?.value, { selectedId: '', presets: [] }), timers: timerPresets(savedTimers?.value) };
  const localText = encode(local), localHash = await sha256(localText), remote = files.get(sharedFile);
  if (!remote) { anchor.shared = await putJson(token, sharedFile, localText, files); return; }
  const text = await remoteText(token, remote, 1024 * 1024), remoteHashValue = await sha256(text);
  if (localHash === remoteHashValue) { anchor.shared = localHash; return; }
  const raw = JSON.parse(text) as { pens?: unknown; timers?: unknown };
  if (!raw || typeof raw !== 'object') throw new Error('Drive의 공용 설정이 손상됐어요.');
  const incoming = { pens: penCollection(raw.pens, { selectedId: '', presets: [] }), timers: timerPresets(raw.timers) };
  const merged = localHash === anchor.shared ? incoming : remoteHashValue === anchor.shared ? local : {
    pens: mergeRestoredPens(local.pens, incoming.pens),
    timers: Array.from(new Map([...incoming.timers, ...local.timers].map(item => [item.id, item])).values()).slice(0, 50),
  };
  await db.settings.bulkPut([{ key: 'pen-presets', value: merged.pens }, { key: 'study-timer-presets', value: merged.timers }]);
  anchor.shared = localHash === anchor.shared ? remoteHashValue : await putJson(token, sharedFile, encode(merged), files);
}

let inFlight: Promise<DriveSyncResult> | undefined;
/** Keeps stable note IDs and immutable PDF/image assets; concurrent edits become copies. */
export function syncDrive(onProgress: (done: number, total: number) => void = () => {}, silent = false, canApply: (id: string) => boolean = () => true): Promise<DriveSyncResult> {
  if (inFlight) return inFlight;
  inFlight = syncImpl(onProgress, silent, canApply).finally(() => { inFlight = undefined; });
  return inFlight;
}
async function syncImpl(onProgress: (done: number, total: number) => void, silent: boolean, canApply: (id: string) => boolean): Promise<DriveSyncResult> {
  const { token, email, accountId } = await driveAccount(silent);
  const enabled = (await db.settings.get('drive-sync-enabled'))?.value as { accountId?: string } | undefined;
  if (enabled?.accountId && enabled.accountId !== accountId) throw new Error('다른 Google 계정이 연결돼 있어요. 기존 계정 연결을 먼저 해제해 주세요.');
  const anchorKey = `drive-sync-anchor:${accountId}`;
  const anchor = ((await db.settings.get(anchorKey))?.value as Anchor | undefined) ?? { notes: {} };
  if (!anchor.notes || typeof anchor.notes !== 'object') anchor.notes = {};
  const files = sortedFiles(await listDriveFiles(token));
  await syncFolders(token, files, anchor);
  await syncSharedSettings(token, files, anchor);
  const local = new Map((await db.notes.toArray()).filter(note => !note.temporary).map(note => [note.id, note]));
  const remote = new Map<string, DriveFile>();
  for (const file of files.values()) {
    const match = /^notelin-v1-note-([0-9a-f-]{36})\.json$/i.exec(file.name);
    if (match) remote.set(match[1], file);
  }
  const ids = new Set([...local.keys(), ...remote.keys()]);
  const result: DriveSyncResult = { email, uploaded: 0, downloaded: 0, conflicts: 0, trashed: 0 };
  let done = 0;
  for (const id of ids) {
    if (!canApply(id)) { onProgress(++done, ids.size); continue; }
    const note = local.get(id), file = remote.get(id), previous = anchor.notes[id];
    const bundle = note ? await localBundle(note) : undefined;
    const localText = bundle ? encode(bundle) : undefined;
    const localHash = localText ? await sha256(localText) : undefined;
    const cloudHash = file ? await remoteHash(token, file) : undefined;
    const tombstone = (await db.settings.get(`drive-delete:${id}`))?.value === true;
    if (bundle && file) {
      if (localHash === cloudHash) anchor.notes[id] = { hash: localHash! };
      else if (previous?.conflictHash === cloudHash) {
        await ensureRemoteAssets(token, bundle, files);
        await putJson(token, noteFileName(id), localText!, files);
        anchor.notes[id] = { hash: localHash! }; result.uploaded++;
      }
      else if (previous && localHash === previous.hash && !previous.suppressed) {
        const received = await readBundle(token, file);
        await applyRemote(token, received.bundle, files, false, canApply);
        anchor.notes[id] = { hash: received.hash }; result.downloaded++;
      } else if (previous && cloudHash === previous.hash) {
        await ensureRemoteAssets(token, bundle, files);
        await putJson(token, noteFileName(id), localText!, files);
        anchor.notes[id] = { hash: localHash! }; result.uploaded++;
      } else {
        const received = await readBundle(token, file);
        await applyRemote(token, received.bundle, files, true, canApply);
        anchor.notes[id] = { hash: previous?.hash || '', conflictHash: cloudHash };
        await db.settings.put({ key: anchorKey, value: anchor });
        await ensureRemoteAssets(token, bundle, files);
        await putJson(token, noteFileName(id), localText!, files);
        anchor.notes[id] = { hash: localHash! }; result.uploaded++; result.conflicts++;
      }
    } else if (bundle) {
      if (previous?.suppressed && note!.deleted) { /* The cloud copy was deleted; retain this device's trash copy. */ }
      else if (previous && localHash === previous.hash) {
        await db.notes.update(id, { deleted: note!.deleted || Date.now() });
        anchor.notes[id] = { ...previous, suppressed: true }; result.trashed++;
      } else {
        await ensureRemoteAssets(token, bundle, files);
        await putJson(token, noteFileName(id), localText!, files);
        anchor.notes[id] = { hash: localHash! }; result.uploaded++;
      }
    } else if (file) {
      if (previous && tombstone && cloudHash === previous.hash) {
        await deleteDriveFile(token, file);
        await db.settings.delete(`drive-delete:${id}`);
        delete anchor.notes[id];
      } else {
        const received = await readBundle(token, file);
        await applyRemote(token, received.bundle, files, !!previous && tombstone, canApply);
        if (previous && tombstone) { await deleteDriveFile(token, file); delete anchor.notes[id]; result.conflicts++; }
        else { anchor.notes[id] = { hash: received.hash }; result.downloaded++; }
      }
    }
    await db.settings.put({ key: anchorKey, value: anchor });
    onProgress(++done, ids.size);
  }
  await db.settings.put({ key: anchorKey, value: anchor });
  await db.settings.put({ key: 'drive-sync-enabled', value: { accountId, email, lastSync: Date.now() } });
  return result;
}

export async function disconnectDrive() {
  await db.settings.delete('drive-sync-enabled');
}

export async function signOutDrive(email: string) {
  if (inFlight) await inFlight.catch(() => {});
  await revokeNativeDrive(email);
  await db.settings.delete('drive-sync-enabled');
  await db.settings.delete('drive-sync-error');
}
