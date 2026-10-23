import { test, expect, type Page } from './standalone-test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

async function workerRelease(page: Page) {
  return page.evaluate(() => new Promise<number>(resolve => {
    const channel = new MessageChannel(); channel.port1.onmessage = e => resolve(e.data);
    navigator.serviceWorker.controller!.postMessage({ type: 'TEST_RELEASE' }, [channel.port2]);
  }));
}

test('settings can check, download and apply a real worker update without losing ink', async ({ page, context }) => {
  let release = 1;
  const dist = resolve('dist');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://localhost'), relative = decodeURIComponent(url.pathname).replace(/^\/mynotes\//, '') || 'index.html';
      const path = resolve(dist, relative);
      if (!url.pathname.startsWith('/mynotes/') || !path.startsWith(dist + sep)) { res.writeHead(404).end(); return; }
      let body = await readFile(path);
      if (relative === 'sw.js') body = Buffer.from(`${body.toString()}\nself.addEventListener('message', e => { if(e.data?.type === 'TEST_RELEASE') e.ports[0].postMessage(${release}); });\n// test release ${release}`);
      if (relative === 'release.json' && release > 1) body = Buffer.from(JSON.stringify({ revision: `test-release-${release}` }));
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.wasm': 'application/wasm' };
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server unavailable');
  try {
    await page.goto(`http://127.0.0.1:${address.port}/mynotes/`); await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.welcome-banner h2')).toHaveText('오늘의 생각을 펼쳐보세요.');
    await expect(page.getByRole('button', { name: '지금 업데이트', exact: true })).toHaveCount(0);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    expect(await workerRelease(page)).toBe(1);
    await page.getByRole('button', { name: '설정 및 백업', exact: true }).click();
    const check = page.getByRole('button', { name: '업데이트 확인', exact: true });
    await expect(check).toBeVisible(); await check.click();
    await expect(page.locator('#update-status')).toHaveText('최신 버전을 사용하고 있어요.');
    await context.setOffline(true); await check.click();
    await expect(page.locator('#update-status')).toContainText('오프라인'); await expect(check).toBeEnabled();
    await context.setOffline(false); await page.getByRole('button', { name: '완료', exact: true }).click();
    await page.getByRole('button', { name: '새 노트', exact: true }).click(); await page.locator('[name=title]').fill('업데이트 보존 검증');
    await page.getByRole('button', { name: '노트 만들기', exact: true }).click(); await expect(page.locator('.page-loading')).toBeHidden();
    const canvas = await page.locator('#paper-live').boundingBox();
    await page.mouse.move(canvas!.x + 100, canvas!.y + 180); await page.mouse.down();
    await page.mouse.move(canvas!.x + 250, canvas!.y + 200, { steps: 15 }); await page.mouse.up();
    release = 2;
    await page.getByRole('button', { name: '노트 설정', exact: true }).click(); await check.click();
    const apply = page.getByRole('button', { name: '저장 후 새 버전 적용', exact: true });
    await expect(apply).toBeVisible(); await expect(page.locator('#update-status')).toContainText('새 버전이 준비');
    await Promise.all([page.waitForEvent('load'), apply.click()]);
    await expect(page.locator('h1')).toContainText('나의 서재'); expect(await workerRelease(page)).toBe(2);
    await page.getByRole('button', { name: '업데이트 보존 검증 열기', exact: true }).click();
    await expect(page.locator('.page-loading')).toBeHidden();
    const strokes = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
      const pages = await new Promise<any[]>(resolve => { const r = db.transaction('pages').objectStore('pages').getAll(); r.onsuccess = () => resolve(r.result); });
      db.close(); return pages.filter(p => !p.items.some((i: any) => i.id === 'welcome-title')).flatMap(p => p.items);
    });
    expect(strokes).toHaveLength(1); expect(strokes[0].kind).toBe('stroke');
    await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
    release = 3;
    // Reopening the app checks the deployment marker, then bypasses a cached sw.js.
    await page.reload();
    await expect(page.locator('.welcome-banner h2')).toHaveText('업데이트가 있어요.');
    const bannerUpdate = page.getByRole('button', { name: '지금 업데이트', exact: true }); await expect(bannerUpdate).toBeVisible();
    await page.screenshot({ path: '../MyNotes-update-banner.png' });
    await Promise.all([page.waitForEvent('load'), bannerUpdate.click()]);
    expect(await workerRelease(page)).toBe(3);
    await expect(page.locator('.welcome-banner h2')).toHaveText('오늘의 생각을 펼쳐보세요.');
    await expect(page.getByRole('button', { name: '지금 업데이트', exact: true })).toHaveCount(0);
    await page.waitForTimeout(1200);
    await expect(page.getByRole('button', { name: '지금 업데이트', exact: true })).toHaveCount(0);
    release = 4;
    // Returning to an already-open app also checks for a new deployment.
    await page.evaluate(() => {
      const now = Date.now();
      Date.now = () => now + 20_000;
      window.dispatchEvent(new Event('focus'));
    });
    await expect(page.locator('.welcome-banner h2')).toHaveText('업데이트가 있어요.');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
