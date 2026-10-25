import { test, expect, emulateStandalone } from './standalone-test';
import { test as browserTest, expect as browserExpect } from '@playwright/test';

test('editor can enter and leave fullscreen', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible();
  await page.getByRole('button', { name: '전체 화면', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('HTML');
  expect(await page.evaluate(() => document.fullscreenElement?.contains(document.querySelector('#toast')))).toBe(true);
  await expect(page.getByRole('button', { name: '전체 화면 종료', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '전체 화면 종료', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(page.getByRole('button', { name: '전체 화면', exact: true })).toBeVisible();
});

browserTest('touch button can request fullscreen directly', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173/mynotes/',
    hasTouch: true, viewport: { width: 1024, height: 800 },
  });
  try {
    await emulateStandalone(context);
    const page = await context.newPage();
    await page.goto('./');
    await page.getByRole('button', { name: '새 노트', exact: true }).tap();
    await page.getByRole('button', { name: '노트 만들기', exact: true }).tap();
    await page.getByRole('button', { name: '전체 화면', exact: true }).tap();
    await browserExpect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('HTML');
  } finally { await context.close(); }
});

browserTest('fullscreen display-mode change does not reload the installed editor', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('notelin-test-loads', String(Number(sessionStorage.getItem('notelin-test-loads') || 0) + 1));
    const nativeMatchMedia = window.matchMedia.bind(window);
    const standalone = nativeMatchMedia('(display-mode: standalone)');
    Object.defineProperty(standalone, 'matches', { get: () => !document.fullscreenElement });
    document.addEventListener('fullscreenchange', () => standalone.dispatchEvent(new Event('change')));
    window.matchMedia = query => query === '(display-mode: standalone)' ? standalone : nativeMatchMedia(query);
  });
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await page.getByRole('button', { name: '전체 화면', exact: true }).click();
  await browserExpect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('HTML');
  await page.waitForTimeout(300);
  browserExpect(await page.evaluate(() => sessionStorage.getItem('notelin-test-loads'))).toBe('1');
  await browserExpect(page.locator('#paper-live')).toBeVisible();
  await page.getByRole('button', { name: '전체 화면 종료', exact: true }).click();
  await browserExpect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  browserExpect(await page.evaluate(() => sessionStorage.getItem('notelin-test-loads'))).toBe('1');
  await page.getByRole('button', { name: '전체 화면', exact: true }).click();
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await browserExpect(page.locator('#library-title')).toContainText('나의 서재');
  await browserExpect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test('fullscreen rejection opens a reversible wider writing area', async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new Error('blocked by browser'));
  });
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await page.getByRole('button', { name: '페이지 목록', exact: true }).click();
  await expect(page.locator('.page-sidebar')).toBeVisible();
  const before = (await page.locator('.paper-viewport').boundingBox())!;
  await page.getByRole('button', { name: '전체 화면', exact: true }).click();
  await expect(page.locator('.editor-shell')).toHaveClass(/focus-fullscreen/);
  await expect(page.getByRole('button', { name: '전체 화면 종료', exact: true })).toBeVisible();
  const after = (await page.locator('.paper-viewport').boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.height).toBeGreaterThan(before.height);
  await page.getByRole('button', { name: '전체 화면 종료', exact: true }).click();
  await expect(page.locator('.editor-shell')).not.toHaveClass(/focus-fullscreen/);
  await expect(page.getByRole('button', { name: '전체 화면', exact: true })).toBeVisible();
  await page.evaluate(() => { Element.prototype.requestFullscreen = () => { throw new Error('blocked synchronously'); }; });
  await page.getByRole('button', { name: '전체 화면', exact: true }).click();
  await expect(page.locator('.editor-shell')).toHaveClass(/focus-fullscreen/);
});
