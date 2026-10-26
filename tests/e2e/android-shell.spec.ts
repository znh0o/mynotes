import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function nativeBridge(page: Page, pdf = '') {
  await page.addInitScript(({ pdf }) => {
    const win = window as any;
    const state = win.nativeTest = {
      listeners: {} as Record<string, (data: unknown) => void>, chunks: [] as string[], exports: [] as string[],
      cancel: false, updates: 0, updateAvailable: true,
      documents: pdf && !sessionStorage.getItem('native-pdf-consumed') ? [{ id: 'android-pdf', name: 'Android에서 연 PDF.pdf', size: atob(pdf).length }] : [],
    };
    win.androidBridge = {};
    const methods = (names: string[]) => names.map(name => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' }));
    win.Capacitor = {
      PluginHeaders: [
        { name: 'App', methods: methods(['addListener', 'removeListener']) },
        { name: 'NotelinDevice', methods: methods(['addListener', 'removeListener', 'setAppearance', 'pendingDocuments', 'readDocument', 'completeDocument', 'beginExport', 'appendExport', 'finishExport', 'cancelExport', 'openUpdates']) },
        { name: 'NotelinUpdater', methods: methods(['addListener', 'removeListener', 'check', 'install']) },
      ],
      nativeCallback: (_plugin: string, _method: string, options: any, callback: (data: unknown) => void) => {
        state.listeners[options.eventName] = callback; return options.eventName;
      },
      nativePromise: async (_plugin: string, method: string, options: any) => {
        if (method === 'pendingDocuments') return { documents: state.documents };
        if (method === 'readDocument') return { data: btoa(atob(pdf).slice(options.offset, options.offset + options.length)) };
        if (method === 'completeDocument') { state.documents = []; sessionStorage.setItem('native-pdf-consumed', '1'); }
        if (method === 'beginExport') { state.chunks = []; return { id: crypto.randomUUID() }; }
        if (method === 'appendExport') {
          if (options.index !== state.chunks.length) throw new Error('Out-of-order file chunk');
          state.chunks.push(atob(options.data));
        }
        if (method === 'finishExport') { state.exports.push(btoa(state.chunks.join(''))); return { saved: !state.cancel }; }
        if (method === 'openUpdates') state.updates++;
        if (method === 'check') return { available: state.updateAvailable, version: state.updateAvailable ? '2.0.1' : '2.0.0', installedVersion: '2.0.0' };
        if (method === 'install') { state.updates++; state.listeners.downloadProgress?.({ percent: 100 }); return { needsPermission: false }; }
        return {};
      },
    };
  }, { pdf });
}

test('Android opens the library without installation UI and routes Back and backup through native APIs', async ({ page }) => {
  await nativeBridge(page);
  await page.goto('./');
  await expect(page.locator('.notes-grid').first()).toBeVisible();
  await expect(page.locator('.install-page')).toHaveCount(0);
  await expect(page.locator('[data-action=library-mode]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Notelin 시작 가이드 열기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).nativeTest.listeners.backButton)).toBe(true);
  await page.evaluate(() => (window as any).nativeTest.listeners.backButton({ canGoBack: true }));
  await expect(page.locator('.notes-grid').first()).toBeVisible();
  await page.getByRole('button', { name: '설정 및 백업', exact: true }).click();
  await expect(page.locator('[data-setting=check-update]')).toHaveCount(0);
  await page.getByRole('button', { name: '업데이트 확인', exact: true }).click();
  await expect(page.locator('#apk-update-status')).toHaveText('2.0.1 업데이트가 있어요.');
  await page.getByRole('button', { name: '다운로드 후 설치', exact: true }).click();
  await expect(page.locator('#apk-update-status')).toContainText('Android 설치 창');
  expect(await page.evaluate(() => (window as any).nativeTest.updates)).toBe(1);
  await page.evaluate(() => { (window as any).nativeTest.updateAvailable = false; });
  await page.getByRole('button', { name: '업데이트 확인', exact: true }).click();
  await expect(page.locator('#apk-update-status')).toHaveText('최신 버전(2.0.0)을 사용하고 있어요.');
  await expect(page.getByRole('button', { name: '다운로드 후 설치', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '전체 백업', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeTest.exports.length)).toBe(1);
  const exported = await page.evaluate(() => (window as any).nativeTest.exports[0]);
  const backup = JSON.parse(Buffer.from(exported, 'base64').toString('utf8'));
  expect(backup.format).toBe('mynotes'); expect(backup.notes).toHaveLength(1);
  expect(backup.settings).toEqual(expect.any(Array));
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test('Android PDF intents import intact bytes once and PDF export uses the document destination picker', async ({ page }) => {
  const original = await PDFDocument.create(); original.addPage([400, 600]).drawText('Opened from Android');
  const bytes = await original.save();
  await nativeBridge(page, Buffer.from(bytes).toString('base64'));
  await page.goto('./');
  await expect(page.locator('#paper-live')).toBeVisible();
  await expect(page.locator('.page-loading')).toBeHidden();
  await page.getByRole('button', { name: 'PDF 내보내기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeTest.exports.length)).toBe(1);
  const exported = await page.evaluate(() => (window as any).nativeTest.exports[0]);
  expect((await PDFDocument.load(Buffer.from(exported, 'base64'))).getPageCount()).toBe(1);
  await page.evaluate(() => { (window as any).nativeTest.cancel = true; });
  await page.getByRole('button', { name: 'PDF 내보내기', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('저장을 취소했어요.');
  await page.reload();
  await expect(page.locator('.notes-grid').first()).toBeVisible();
  await expect(page.locator('#note-results .note-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Android에서 연 PDF 열기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible();
  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('mynotes-v1'); request.onsuccess = () => resolve(request.result); });
    const assets = await new Promise<any[]>(resolve => { const request = database.transaction('assets').objectStore('assets').getAll(); request.onsuccess = () => resolve(request.result); });
    database.close(); return [...new Uint8Array(await assets[0].blob.arrayBuffer())];
  });
  expect(stored).toEqual([...bytes]);
});
