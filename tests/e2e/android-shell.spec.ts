import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function nativeBridge(page: Page, pdf = '') {
  await page.addInitScript(({ pdf }) => {
    const win = window as any;
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => query.trim() === '(display-mode: standalone)'
      ? { ...matchMedia(query), matches: true } as MediaQueryList : matchMedia(query);
    const state = win.nativeTest = {
      listeners: {} as Record<string, (data: unknown) => void>, chunks: [] as string[], exports: [] as string[],
      cancel: false, updates: 0, updateAvailable: true, browserOpens: 0, aiOpens: 0, browserCloses: 0, browserHidden: false, browserAddresses: [] as string[], browserNoteIds: [] as string[],
      documents: pdf && !sessionStorage.getItem('native-pdf-consumed') ? [{ id: 'android-pdf', name: 'Android에서 연 PDF.pdf', size: atob(pdf).length }] : [],
    };
    win.androidBridge = {};
    const methods = (names: string[]) => names.map(name => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' }));
    win.Capacitor = {
      PluginHeaders: [
        { name: 'App', methods: methods(['addListener', 'removeListener']) },
        { name: 'NotelinDevice', methods: methods(['addListener', 'removeListener', 'setAppearance', 'pendingDocuments', 'readDocument', 'completeDocument', 'beginExport', 'appendExport', 'finishExport', 'cancelExport', 'openUpdates', 'openStudyBrowser', 'openStudyAI', 'closeStudyPanel', 'setStudyPanelOccluded', 'getStudyPanelSettings', 'setStudyPanelSide']) },
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
        if (method === 'openStudyBrowser') { state.browserOpens++; state.browserAddresses.push(options.url || ''); state.browserNoteIds.push(options.noteId); }
        if (method === 'openStudyAI') state.aiOpens++;
        if (method === 'closeStudyPanel') state.browserCloses++;
        if (method === 'setStudyPanelOccluded') state.browserHidden = options.hidden;
        if (method === 'getStudyPanelSettings') return { side: localStorage.getItem('native-panel-side') || 'right' };
        if (method === 'setStudyPanelSide') localStorage.setItem('native-panel-side', options.side);
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
  const browser = page.getByRole('button', { name: '인터넷 패널', exact: true });
  await expect(browser).toHaveAttribute('aria-expanded', 'false');
  const fullWidth = (await page.locator('.editor-shell').boundingBox())!.width;
  await browser.click();
  await expect(browser).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.editor-shell')).toHaveClass(/study-browser-open/);
  expect((await page.locator('.editor-shell').boundingBox())!.width).toBeCloseTo(fullWidth * 4 / 5, 0);
  await page.evaluate(() => dispatchEvent(new CustomEvent('notelin-study-browser-resized', { detail: { ratio: .4 } })));
  expect((await page.locator('.editor-shell').boundingBox())!.width).toBeCloseTo(fullWidth * .6, 0);
  expect(await page.evaluate(() => (window as any).nativeTest.browserOpens)).toBe(1);
  await browser.click();
  await expect(page.locator('.editor-shell')).not.toHaveClass(/study-browser-open/);
  expect(await page.evaluate(() => (window as any).nativeTest.browserCloses)).toBe(1);
  await browser.click();
  await page.evaluate(() => (window as any).nativeTest.listeners.backButton({ canGoBack: true }));
  await expect(browser).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#paper-live')).toBeVisible();
  expect((await page.locator('.editor-shell').boundingBox())!.width).toBe(fullWidth);
  await browser.click();
  await page.getByRole('button', { name: '노트 내 텍스트 검색', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeTest.browserHidden)).toBe(true);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeTest.browserHidden)).toBe(false);
  // Closing the dialog also traverses history before the next native Back.
  await expect.poll(() => page.evaluate(() => !!history.state?.overlay)).toBe(false);
  await page.evaluate(() => dispatchEvent(new Event('notelin-study-browser-closed')));
  await expect(browser).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => page.evaluate(() => !!(window as any).nativeTest.listeners.stylusButtonPressed)).toBe(true);
  await page.evaluate(() => (window as any).nativeTest.listeners.stylusButtonPressed({}));
  await expect(page.getByRole('button', { name: '지우개', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as any).nativeTest.listeners.stylusButtonPressed({}));
  await expect(page.getByRole('button', { name: '펜', exact: true })).toHaveAttribute('aria-pressed', 'true');
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

test('AI and internet use separate panels and switch without closing the other context', async ({ page }) => {
  await nativeBridge(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Notelin 시작 가이드 열기', exact: true }).click();
  const internet = page.getByRole('button', { name: '인터넷 패널', exact: true });
  const ai = page.getByRole('button', { name: 'AI · ChatGPT 열기', exact: true });
  await expect(ai).toBeVisible();
  await ai.click();
  await expect(ai).toHaveAttribute('aria-expanded', 'true');
  await expect(internet).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.editor-shell')).toHaveAttribute('data-study-panel', 'ai');
  expect(await page.evaluate(() => (window as any).nativeTest.browserOpens)).toBe(0);
  expect(await page.evaluate(() => (window as any).nativeTest.aiOpens)).toBe(1);
  await internet.click();
  await expect(internet).toHaveAttribute('aria-expanded', 'true');
  await expect(ai).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.editor-shell')).toHaveAttribute('data-study-panel', 'browser');
  expect(await page.evaluate(() => (window as any).nativeTest.browserCloses)).toBe(0);
  await ai.click();
  await expect(ai).toHaveAttribute('aria-expanded', 'true');
  await expect(internet).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => (window as any).nativeTest.browserOpens)).toBe(1);
  expect(await page.evaluate(() => (window as any).nativeTest.aiOpens)).toBe(2);
  await ai.click();
  await expect(ai).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.editor-shell')).not.toHaveClass(/study-browser-open/);
  expect(await page.evaluate(() => (window as any).nativeTest.browserCloses)).toBe(1);
  await ai.click();
  await page.evaluate(() => dispatchEvent(new Event('notelin-study-browser-closed')));
  await expect(ai).toHaveAttribute('aria-expanded', 'false');
  await expect(internet).toHaveAttribute('aria-expanded', 'false');
});

test('internet requests are scoped to the current note when switching and reopening notes', async ({ page }) => {
  await nativeBridge(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Notelin 시작 가이드 열기', exact: true }).click();
  await page.getByRole('button', { name: '인터넷 패널', exact: true }).click();
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('별도의 인터넷을 쓰는 노트');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible();
  await page.getByRole('button', { name: '인터넷 패널', exact: true }).click();
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: 'Notelin 시작 가이드 열기', exact: true }).click();
  await page.getByRole('button', { name: '인터넷 패널', exact: true }).click();
  const ids = await page.evaluate(() => (window as any).nativeTest.browserNoteIds as string[]);
  expect(ids).toHaveLength(3);
  expect(ids[0]).toEqual(expect.any(String));
  expect(ids[0].length).toBeGreaterThan(0);
  expect(ids[1]).not.toBe(ids[0]);
  expect(ids[2]).toBe(ids[0]);
  expect(await page.evaluate(() => (window as any).nativeTest.browserAddresses)).toEqual(['', '', '']);
});

test('panel position is saved in settings and applies to internet and AI after reopening the app', async ({ page }) => {
  await nativeBridge(page);
  await page.goto('./');
  await page.getByRole('button', { name: '설정 및 백업', exact: true }).click();
  const positions = page.getByRole('group', { name: '인터넷 · AI 패널 위치', exact: true });
  await expect(positions.getByRole('button', { name: '오른쪽', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await positions.getByRole('button', { name: '왼쪽', exact: true }).click();
  await expect(positions.getByRole('button', { name: '왼쪽', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-study-panel-side', 'left');
  await page.getByRole('button', { name: 'Notelin 시작 가이드 열기', exact: true }).click();
  const workspace = page.locator('.editor-shell');
  const full = (await workspace.boundingBox())!;
  await page.getByRole('button', { name: '인터넷 패널', exact: true }).click();
  expect((await workspace.boundingBox())!.x).toBeCloseTo(full.width * .2, 0);
  expect((await workspace.boundingBox())!.width).toBeCloseTo(full.width * .8, 0);
  await page.getByRole('button', { name: 'AI · ChatGPT 열기', exact: true }).click();
  expect((await workspace.boundingBox())!.x).toBeCloseTo(full.width * .2, 0);
  await page.getByRole('button', { name: 'AI · ChatGPT 열기', exact: true }).click();
  expect((await workspace.boundingBox())!.x).toBe(full.x);
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '설정 및 백업', exact: true }).click();
  await positions.getByRole('button', { name: '오른쪽', exact: true }).click();
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.getByRole('button', { name: 'Notelin 시작 가이드 열기', exact: true }).click();
  await page.getByRole('button', { name: '인터넷 패널', exact: true }).click();
  expect((await workspace.boundingBox())!.x).toBe(full.x);
  expect((await workspace.boundingBox())!.width).toBeCloseTo(full.width * .8, 0);
});

test('Android PDF intents import intact bytes once and PDF export uses the document destination picker', async ({ page }) => {
  const original = await PDFDocument.create(); original.addPage([400, 600]).drawText('Opened from Android');
  const bytes = await original.save();
  await nativeBridge(page, Buffer.from(bytes).toString('base64'));
  await page.goto('./');
  await expect(page.locator('#paper-live')).toBeVisible();
  await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.getByRole('button', { name: '서재에 저장', exact: true })).toBeVisible();
  await expect(page.locator('.external-pdf-notice')).toBeVisible();
  await expect(page.locator('.external-pdf-notice')).toHaveCount(0, { timeout: 7000 });
  await expect(page.getByRole('button', { name: '서재에 저장', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'PDF 내보내기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeTest.exports.length)).toBe(1);
  const exported = await page.evaluate(() => (window as any).nativeTest.exports[0]);
  expect((await PDFDocument.load(Buffer.from(exported, 'base64'))).getPageCount()).toBe(1);
  await page.evaluate(() => { (window as any).nativeTest.cancel = true; });
  await page.getByRole('button', { name: 'PDF 내보내기', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('저장을 취소했어요.');
  await page.getByRole('button', { name: '서재에 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '서재에 저장', exact: true })).toHaveCount(0);
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

test('Android external PDF is discarded when closed without saving to the library', async ({ page }) => {
  const original = await PDFDocument.create(); original.addPage([400, 600]);
  await nativeBridge(page, Buffer.from(await original.save()).toString('base64'));
  await page.goto('./');
  await expect(page.getByRole('button', { name: '서재에 저장', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await expect(page.locator('#note-results .note-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#note-results .note-card')).toHaveCount(1);
  const count = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('mynotes-v1'); request.onsuccess = () => resolve(request.result); });
    const assets = await new Promise<any[]>(resolve => { const request = database.transaction('assets').objectStore('assets').getAll(); request.onsuccess = () => resolve(request.result); });
    database.close(); return assets.length;
  });
  expect(count).toBe(0);
});
