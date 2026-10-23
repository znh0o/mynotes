import { test, expect } from '@playwright/test';

test('browser mode shows only the install experience and never opens the notes database', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /생각이 머무는/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notelin 설치하기' })).toBeVisible();
  await expect(page.locator('#paper-live,.library-shell')).toHaveCount(0);
  expect(await page.evaluate(() => indexedDB.databases().then(rows => rows.some(row => row.name === 'mynotes-v1')))).toBe(false);
  const manifest = await page.evaluate(async () => (await fetch(new URL('manifest.webmanifest', location.href))).json());
  expect(manifest).toMatchObject({ id: '/mynotes/', start_url: '/mynotes/', scope: '/mynotes/', display: 'standalone' });
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

test('install page fits tablet and phone screens without horizontal scrolling', async ({ page }) => {
  for (const size of [{ width: 800, height: 1280 }, { width: 390, height: 844 }]) {
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
});
