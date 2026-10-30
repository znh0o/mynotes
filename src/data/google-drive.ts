import { backupBlob, restore } from './store';
import { authorizeNativeDrive } from '../platform/native';

const api = 'https://www.googleapis.com/drive/v3';
const uploadApi = 'https://www.googleapis.com/upload/drive/v3';
const backupName = 'Notelin-backup-v1.json';
const maxRestoreSize = 400 * 1024 * 1024;

export interface DriveFile { id: string; name: string; size?: string; modifiedTime?: string; appProperties?: Record<string, string> }

export async function googleRequest(token: string, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers, redirect: 'follow' });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Google Drive 권한을 확인하지 못했어요. Google 계정과 Drive API 설정을 확인해 주세요.');
    if (response.status === 429) throw new Error('Google Drive 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
    throw new Error(`Google Drive 요청에 실패했어요. (${response.status})`);
  }
  return response;
}

export async function listDriveFiles(token: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let next: string | undefined;
  do {
    const params = new URLSearchParams({ spaces: 'appDataFolder', q: 'trashed = false', fields: 'nextPageToken,files(id,name,size,modifiedTime,appProperties)', pageSize: '1000' });
    if (next) params.set('pageToken', next);
    const result = await (await googleRequest(token, `${api}/files?${params}`)).json() as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(result.files || []).filter(file => /^[\w-]+$/.test(file.id)));
    next = result.nextPageToken;
  } while (next);
  return files;
}

async function listBackups(token: string): Promise<DriveFile[]> {
  return (await listDriveFiles(token)).filter(file => file.name === backupName)
    .sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
}

export async function driveAccount(silent = false) {
  const token = await authorizeNativeDrive(silent);
  const result = await (await googleRequest(token, 'https://www.googleapis.com/oauth2/v3/userinfo')).json() as { sub?: string; email?: string };
  if (!result.email || !result.sub) throw new Error('Google 계정을 확인하지 못했어요.');
  return { token, email: result.email, accountId: result.sub };
}

export async function putDriveFile(token: string, name: string, blob: Blob, existing?: DriveFile, hash?: string): Promise<DriveFile> {
  const endpoint = existing ? `${uploadApi}/files/${encodeURIComponent(existing.id)}` : `${uploadApi}/files`;
  const metadata = existing ? {} as Record<string, unknown> : { name, mimeType: blob.type || 'application/octet-stream', parents: ['appDataFolder'] } as Record<string, unknown>;
  if (hash) metadata.appProperties = { sha256: hash };
  const start = await googleRequest(token, `${endpoint}?uploadType=resumable&fields=id,name,modifiedTime,appProperties`, {
    method: existing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) },
    body: JSON.stringify(metadata),
  });
  const location = start.headers.get('Location');
  if (!location || !location.startsWith('https://www.googleapis.com/')) throw new Error('Google Drive 업로드 주소를 받지 못했어요.');
  const response = await googleRequest(token, location, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  return await response.json() as DriveFile;
}

export async function downloadDriveFile(token: string, file: DriveFile): Promise<Blob> {
  return (await googleRequest(token, `${api}/files/${encodeURIComponent(file.id)}?alt=media`)).blob();
}

export async function deleteDriveFile(token: string, file: DriveFile) {
  await googleRequest(token, `${api}/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
}

/** Uploads one complete, restorable snapshot. Existing local records stay untouched. */
export async function backupToDrive(): Promise<{ email: string; size: number }> {
  const { token, email } = await driveAccount();
  const blob = await backupBlob();
  if (blob.size > maxRestoreSize) throw new Error('Drive 백업이 400MB를 넘었어요. 파일별 동기화가 필요해요.');
  const existing = (await listBackups(token))[0];
  await putDriveFile(token, backupName, blob, existing);
  return { email, size: blob.size };
}

/** Import as copies through the existing validated restore path. No local data is removed. */
export async function restoreFromDrive(): Promise<{ email: string; modifiedTime?: string }> {
  const { token, email } = await driveAccount();
  const latest = (await listBackups(token))[0];
  if (!latest) throw new Error('이 Google 계정에 Notelin 백업이 없어요.');
  if (Number(latest.size || 0) > maxRestoreSize) throw new Error('백업 파일이 400MB를 넘어 복원할 수 없어요.');
  const blob = await downloadDriveFile(token, latest);
  await restore(new File([blob], backupName, { type: 'application/json' }));
  return { email, modifiedTime: latest.modifiedTime };
}
