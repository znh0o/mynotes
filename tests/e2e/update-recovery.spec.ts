import { test, expect, type Page } from './standalone-test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('mynotes-v1'); request.onsuccess = () => resolve(request.result); });
    const result: Record<string, unknown> = {};
    for (const name of ['notes', 'pages', 'assets', 'settings']) {
      const rows = await new Promise<any[]>(resolve => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); });
      result[name] = await Promise.all(rows.map(async row => row.blob ? { ...row, blob: await row.blob.text() } : row));
    }
    db.close(); return result;
  });
}

test('recovery bypasses an older cached app and repairs a failed worker fetch without touching notes', async ({ page }) => {
  const dist = resolve('dist'); let repair = false;
  const legacy = `self.addEventListener('install',()=>self.skipWaiting());
    self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(new Response('<h1>이전 캐시 앱</h1>',{headers:{'Content-Type':'text/html;charset=utf-8'}}));});`;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL('http://localhost' + req.url!);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+mynotes\//, '') || 'index.html';
      const path = resolve(dist, relative);
      if (!/^\/+mynotes\//.test(url.pathname) || !path.startsWith(dist + sep)) { res.writeHead(404).end(); return; }
      if (relative === 'sw.js' && !repair) { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }).end(legacy); return; }
      if (relative === 'sw.js' && repair && !url.search) { res.writeHead(503).end('script unavailable at old URL'); return; }
      // The new worker must not rely on the old external worker dependencies.
      if (/^(release-worker|share-target-sw|workbox-.*)\.js$/.test(relative)) { res.writeHead(404).end(); return; }
      let body: string | Buffer = relative === 'index.html' && !repair ? '<h1>기존 앱</h1>' : await readFile(path);
      const types: Record<string, string> = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server unavailable');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(origin + '/mynotes/');
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => {
        const request = indexedDB.open('mynotes-v1', 1);
        request.onupgradeneeded = () => {
          for (const name of ['notes', 'pages', 'assets', 'folders']) request.result.createObjectStore(name, { keyPath: 'id' });
          request.result.createObjectStore('settings', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction(['notes', 'pages', 'assets', 'settings'], 'readwrite');
      tx.objectStore('notes').put({ id: 'kept-note', title: '복구할 노트', cover: '#5e85bd', folderId: null, pageIds: ['kept-page'], created: 1, updated: 1, opened: 1, favorite: false, deleted: null });
      tx.objectStore('pages').put({ id: 'kept-page', noteId: 'kept-note', width: 794, height: 1123, paper: 'lined', paperColor: '#fffefb', spacing: 32, revision: 1,
        items: [{ id: 'saved-ink', kind: 'stroke', tool: 'pen', color: '#dd3344', width: 2, pressure: false, points: [{ x: 100, y: 100, p: .5, t: 0 }, { x: 200, y: 110, p: .5, t: 1 }] }] });
      tx.objectStore('assets').put({ id: 'kept-asset', noteId: 'kept-note', name: '원본.pdf', blob: new Blob(['original pdf data'], { type: 'application/pdf' }) });
      tx.objectStore('settings').put({ key: 'initialized', value: true });
      await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
      await navigator.serviceWorker.register('/mynotes/sw.js', { scope: '/mynotes/' });
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.reload(); await expect(page.getByRole('heading', { name: '이전 캐시 앱' })).toBeVisible();
    const before = await snapshot(page); repair = true;
    const failure = await page.evaluate(async () => {
      try { await (await navigator.serviceWorker.getRegistration())!.update(); return ''; }
      catch (error) { return String(error); }
    });
    expect(failure).toContain('Failed to update');
    const intercepted = await page.goto(origin + '/mynotes/repair.html');
    expect(intercepted!.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('heading', { name: '이전 캐시 앱' })).toBeVisible();
    const direct = await page.goto(origin + '//mynotes/repair.html');
    expect(direct!.fromServiceWorker()).toBe(false);
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    await page.getByRole('button', { name: '복구 시작' }).click();
    await expect(page.locator('#status')).toContainText('복구가 완료됐어요');
    expect(await snapshot(page)).toEqual(before);
    await page.goto(origin + '/mynotes/');
    await page.getByRole('button', { name: '복구할 노트 열기', exact: true }).click();
    await expect(page.locator('.page-loading')).toBeHidden();
    const after = await snapshot(page) as any;
    expect(after.pages[0].items).toEqual((before as any).pages[0].items);
    expect(after.assets).toEqual((before as any).assets);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
