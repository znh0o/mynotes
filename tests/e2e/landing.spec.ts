import { test, expect } from '@playwright/test';

test('install site follows system dark mode and allows a saved appearance choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('link', { name: 'Android 앱 다운로드' })).toBeVisible();
  await page.getByRole('button', { name: '화면 모드' }).click();
  await expect(page.getByRole('button', { name: '기기 설정' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '밝게' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '화면 모드' }).click();
  await page.getByRole('button', { name: '어둡게' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: '../Notelin-install-dark.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '화면 모드' }).click();
  await page.getByRole('button', { name: '기기 설정' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#paper-live,.library-shell')).toHaveCount(0);
});

test('fullscreen launch opens the notebook library and is still a valid install mode', async ({ page }) => {
  await page.addInitScript(() => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: fullscreen)'
      ? { ...native(query), matches: true } as MediaQueryList
      : native(query);
  });
  await page.goto('./');
  await expect(page.locator('#library-title')).toContainText('나의 서재');
  await expect(page.locator('.install-page')).toHaveCount(0);
});

test('browser mode shows only the install experience and never opens the notes database', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /손으로 쓰는/ })).toBeVisible();
  await expect(page.getByText('S펜에 맞춘 필기', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'PDF 공부' }).click();
  await expect(page.getByText('PDF 위에 바로 기록', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Android 앱 다운로드' })).toBeVisible();
  await expect.poll(() => page.locator('.install-device img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1440);
  await expect(page.locator('#paper-live,.library-shell')).toHaveCount(0);
  expect(await page.evaluate(() => indexedDB.databases().then(rows => rows.some(row => row.name === 'mynotes-v1')))).toBe(false);
  const manifest = await page.evaluate(async () => (await fetch(new URL('manifest.webmanifest', location.href))).json());
  expect(manifest).toMatchObject({ id: '/mynotes/', start_url: '/mynotes/', scope: '/mynotes/', display: 'fullscreen' });
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
  await expect(page.getByRole('link', { name: 'Android 앱 다운로드' })).toBeVisible();
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
    expect(manifest).toMatchObject({ id: '/mynotes/', start_url: '/mynotes/', scope: '/mynotes/', display: 'fullscreen' });
    expect(manifest).not.toHaveProperty('share_target');
    expect(manifest.icons).toHaveLength(3);
    const cdp = await context.newCDPSession(page);
    await expect.poll(async () => (await cdp.send('Page.getAppManifest')).url).toBe(new URL('/mynotes/manifest-samsung.webmanifest', page.url()).href);
    expect((await cdp.send('Page.getAppManifest')).errors).toEqual([]);
    await cdp.detach();
  } finally { await context.close(); }
});

test('phone installation uses standalone manifests in Chrome and Samsung Internet', async ({ browser }) => {
  for (const [browserName, userAgent, file] of [
    ['Chrome', 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/143.0.0.0 Mobile Safari/537.36', 'manifest-phone.webmanifest'],
    ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 SamsungBrowser/30.0 Chrome/143.0.0.0 Mobile Safari/537.36', 'manifest-phone-samsung.webmanifest'],
  ]) {
    const context = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173/mynotes/',
      userAgent, viewport: { width: 390, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto('./');
      await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/mynotes/' + file);
      const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href)).json());
      expect(manifest.display, browserName).toBe('standalone');
      if (browserName === 'Samsung Internet') expect(manifest).not.toHaveProperty('share_target');
      else expect(manifest).toHaveProperty('share_target');
      await expect(page.locator('.install-page')).toBeVisible();
    } finally {
      await context.close();
    }
  }
});

test('download button delivers the Android APK and does not invoke the browser install prompt', async ({ page }) => {
  await page.route('https://github.com/znh0o/mynotes/releases/latest/download/Notelin.apk', route => route.fulfill({
    status: 200, contentType: 'application/vnd.android.package-archive',
    headers: { 'content-disposition': 'attachment; filename="Notelin.apk"' }, body: 'test-apk-download',
  }));
  await page.goto('./');
  await page.evaluate(() => {
    (window as any).installPromptCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperty(event, 'prompt', { value: async () => { (window as any).installPromptCalls++; } });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('installation event was not deferred');
  });
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Android 앱 다운로드' }).click();
  expect((await download).suggestedFilename()).toBe('Notelin.apk');
  expect(await page.evaluate(() => (window as any).installPromptCalls)).toBe(0);
  await expect(page.locator('#install-guide')).not.toContainText('복원');
  await expect(page.locator('#install-guide')).toContainText('다운로드한 파일 열기');
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await expect(page.locator('.library-shell')).toHaveCount(0);
});

test('install page fits desktop, tablet and phone screens without horizontal scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const size of [{ width: 1440, height: 900 }, { width: 800, height: 1280 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.goto('./');
    await expect(page.getByRole('link', { name: 'Android 앱 다운로드' })).toBeVisible();
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
  await expect(page.getByRole('link', { name: 'Android 앱 다운로드' })).toBeVisible();
  await page.getByRole('link', { name: 'Android 앱 다운로드' }).click();
  await expect(page.locator('#install-manual')).toContainText('인터넷 연결이 필요해요');
  await expect(page.locator('.library-shell')).toHaveCount(0);
  await expect.poll(() => page.locator('#preview-write-panel img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1440);
  await page.getByRole('tab', { name: '나만의 서재' }).click();
  await expect.poll(() => page.locator('#preview-library-panel img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1440);
});
