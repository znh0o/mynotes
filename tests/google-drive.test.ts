import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(async () => 'access-token'),
  backup: vi.fn(async () => new Blob(['{"format":"mynotes"}'], { type: 'application/json' })),
  restore: vi.fn(async (_file: File) => {}),
}));
vi.mock('../src/platform/native', () => ({ authorizeNativeDrive: mocks.authorize }));
vi.mock('../src/data/store', () => ({ backupBlob: mocks.backup, restore: mocks.restore }));

import { backupToDrive, restoreFromDrive } from '../src/data/google-drive';

describe('Google Drive backup transport', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('writes a restorable snapshot to appDataFolder without putting a token in the URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/userinfo')) return new Response(JSON.stringify({ sub: 'account-one', email: 'student@example.com' }));
      if (url.includes('uploadType=resumable')) return new Response('{}', { headers: { Location: 'https://www.googleapis.com/upload/session/one' } });
      if (url.includes('/drive/v3/files?')) return new Response(JSON.stringify({ files: [] }));
      return new Response(JSON.stringify({ id: 'file-one' }));
    }));
    const result = await backupToDrive();
    expect(result.email).toBe('student@example.com');
    expect(calls.map(call => call.url).every(url => !url.includes('access-token'))).toBe(true);
    const start = calls.find(call => call.url.includes('uploadType=resumable'))!;
    expect(start.init.method).toBe('POST');
    expect(JSON.parse(String(start.init.body)).parents).toEqual(['appDataFolder']);
    expect(new Headers(start.init.headers).get('Authorization')).toBe('Bearer access-token');
    expect(calls.at(-1)?.init.method).toBe('PUT');
  });

  it('restores the latest cloud backup through the existing copy-only validator', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/userinfo')) return new Response(JSON.stringify({ sub: 'account-one', email: 'student@example.com' }));
      if (url.includes('/drive/v3/files?')) return new Response(JSON.stringify({ files: [{ id: 'older', name: 'Notelin-backup-v1.json', modifiedTime: '2026-01-01' }, { id: 'newer', name: 'Notelin-backup-v1.json', modifiedTime: '2026-10-30' }] }));
      if (url.includes('/newer?alt=media')) return new Response('{"format":"mynotes"}', { headers: { 'Content-Type': 'application/json' } });
      throw new Error('Unexpected request');
    }));
    const result = await restoreFromDrive();
    expect(result.modifiedTime).toBe('2026-10-30');
    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(mocks.restore.mock.calls[0][0].name).toBe('Notelin-backup-v1.json');
  });
});
