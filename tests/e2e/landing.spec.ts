import { test, expect } from '@playwright/test';

test('browser mode shows only the install experience and never opens the notes database', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /생각이 쌓이는/ })).toBeVisible();
  await expect(page.getByText('S펜에 맞춘 필기', { exact: true })).toBeVisible();
  await expect(page.getByText('PDF 위에 바로 기록', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notelin 설치하기' })).toBeVisible();
  await expect.poll(() => page.locator('.install-device img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1440);
  await expect(page.locator('#paper-live,.library-shell')).toHaveCount(0);
  expect(await page.evaluate(() => indexedDB.databases().then(rows => rows.some(row => row.name === 'mynotes-v1')))).toBe(false);
  const manifest = await page.evaluate(async () => (await fetch(new URL('manifest.webmanifest', location.href))).json());
  expect(manifest).toMatchObject({ id: '/mynotes/', start_url: '/mynotes/', scope: '/mynotes/', display: 'standalone' });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/mynotes/manifest.webmanifest');
  await page.screenshot({ path: '../Notelin-install-landing.png', fullPage: true });
  await page.evaluate(async () => {
    const request = indexedDB.open('mynotes-v1', 1);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => request.result.createObjectStore('existing-notes');
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Notelin 설치하기' })).toBeVisible();
  expect(await page.evaluate(() => indexedDB.databases().then(rows => rows.some(row => row.name === 'mynotes-v1')))).toBe(true);
});

test('Samsung Internet receives an install manifest without the POST file share target', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173/mynotes/',
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/143.0.0.0 Safari/537.36',
  });
  try {
    const page = await context.newPage();
    await page.goto('./');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/mynotes/manifest-samsung.webmanifest');
    const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href)).json());
    expect(manifest).toMatchObject({ id: '/mynotes/', start_url: '/mynotes/', scope: '/mynotes/', display: 'standalone' });
    expect(manifest).not.toHaveProperty('share_target');
    expect(manifest.icons).toHaveLength(3);
    const cdp = await context.newCDPSession(page);
    await expect.poll(async () => (await cdp.send('Page.getAppManifest')).url).toBe(new URL('/mynotes/manifest-samsung.webmanifest', page.url()).href);
    expect((await cdp.send('Page.getAppManifest')).errors).toEqual([]);
    await cdp.detach();
  } finally { await context.close(); }
});

test('install button uses the browser prompt when available and otherwise explains manual installation', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Notelin 설치하기' }).click();
  await expect(page.locator('#install-manual')).toContainText('브라우저');
  await expect(page.locator('#install-manual')).toHaveClass(/install-manual-emphasis/);
  await page.evaluate(() => {
    (window as any).installPromptCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperty(event, 'prompt', { value: async () => { (window as any).installPromptCalls++; } });
    Object.defineProperty(event, 'userChoice', { value: Promise.resolve({ outcome: 'accepted' }) });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('installation event was not deferred');
  });
  await page.getByRole('button', { name: 'Notelin 설치하기' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).installPromptCalls)).toBe(1);
  await expect(page.locator('#install-manual')).toContainText('Notelin 아이콘');
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('#install-manual')).toContainText('설치가 완료됐어요');
  await expect(page.locator('.library-shell')).toHaveCount(0);
});

test('install page fits desktop, tablet and phone screens without horizontal scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const size of [{ width: 1440, height: 900 }, { width: 800, height: 1280 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Notelin 설치하기' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: `../Notelin-install-${size.width}.png`, fullPage: true });
  }
});

test('GitHub Pages install route remains available offline after service worker caching', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Notelin 설치하기' })).toBeVisible();
  await expect(page.locator('.library-shell')).toHaveCount(0);
  await expect.poll(() => page.locator('#preview-write-panel img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1440);
  await page.getByRole('tab', { name: '나만의 서재' }).click();
  await expect.poll(() => page.locator('#preview-library-panel img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1440);
});
