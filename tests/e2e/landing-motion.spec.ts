import { test, expect } from '@playwright/test';

test('product preview switches with touch and keyboard without starting the notes app', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173/mynotes/' });
  const page = await context.newPage();
  try {
    await page.goto('./');
    const write = page.getByRole('tab', { name: '필기하는 순간' });
    const library = page.getByRole('tab', { name: '나만의 서재' });
    await library.tap();
    await expect(library).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#preview-library-panel')).toBeVisible();
    await expect(page.locator('#preview-write-panel')).toBeHidden();
    await library.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'PDF 공부' })).toBeFocused();
    await expect(page.locator('#preview-pdf-panel')).toBeVisible();
    await page.keyboard.press('Home');
    await expect(write).toBeFocused();
    await expect(write).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#preview-write-panel')).toBeVisible();
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    await expect(page.locator('#paper-live,.library-shell')).toHaveCount(0);
  } finally { await context.close(); }
});

test('scroll reveals finish and reduced motion keeps every section available', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./');
  const lastSection = page.locator('.install-guide-details');
  const position = await lastSection.evaluate(element => element.getBoundingClientRect().top + window.scrollY);
  await page.evaluate(top => window.scrollTo(0, top - 100), position);
  await expect(lastSection).toHaveClass(/is-visible/);
  await expect(lastSection).toHaveCSS('opacity', '1');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(lastSection).not.toHaveClass(/is-visible/);
  await expect(lastSection).toHaveCSS('opacity', '0');
  await page.evaluate(top => window.scrollTo(0, top - 100), position);
  await expect(lastSection).toHaveClass(/is-visible/);
  await expect(lastSection).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.install-page')).not.toHaveClass(/install-motion/);
  for (const reveal of await page.locator('[data-reveal]').all()) {
    await expect(reveal).toHaveCSS('opacity', '1');
  }
  await page.reload();
  await expect(page.locator('.install-page')).not.toHaveClass(/install-motion/);
  await expect(page.locator('.install-hero h1')).toHaveCSS('animation-name', 'none');
  await page.getByRole('link', { name: '설치 방법', exact: true }).click();
  await expect(page.locator('#install-guide')).toBeFocused();
  await expect(page.getByRole('link', { name: 'APK 다운로드', exact: true })).toBeInViewport();
  await page.getByRole('link', { name: '맨 위로' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('header and final call to action download the same current Android APK', async ({ page }) => {
  await page.route('https://github.com/znh0o/mynotes/releases/latest/download/Notelin.apk', route => route.fulfill({
    status: 200, contentType: 'application/vnd.android.package-archive',
    headers: { 'content-disposition': 'attachment; filename="Notelin.apk"' }, body: 'test-apk-download',
  }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  for (const selector of ['.install-header [data-download]', '#install-guide [data-download]']) {
    const link = page.locator(selector);
    await expect(link).toHaveAttribute('href', 'https://github.com/znh0o/mynotes/releases/latest/download/Notelin.apk');
    const download = page.waitForEvent('download'); await link.click();
    expect((await download).suggestedFilename()).toBe('Notelin.apk');
  }
});
