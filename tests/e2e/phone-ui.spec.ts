import { test, expect, emulateStandalone } from './standalone-test';
import { test as browserTest } from '@playwright/test';

test('phone navigation, writing dock and document menu keep the same note across layout changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-device-ui', 'phone');
  await expect(page.locator('.phone-bottom-nav')).toBeVisible();
  await expect(page.getByRole('button', { name: '새 노트', exact: true })).toBeVisible();
  await page.screenshot({ path: '../Notelin-phone-library.png' });
  await page.getByRole('button', { name: '폴더 열기' }).click();
  await expect(page.locator('.library-sidebar')).toHaveClass(/mobile-open/);
  await expect(page.locator('.library-sidebar')).not.toHaveAttribute('inert', '');
  await page.getByRole('button', { name: '메뉴 닫기' }).click({ position: { x: 380, y: 300 } });
  await expect(page.locator('.library-sidebar')).not.toHaveClass(/mobile-open/);
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('휴대폰 필기');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.locator('.editor-header .note-tab.active')).toContainText('휴대폰 필기');
  const dock = (await page.locator('.ink-toolbar').boundingBox())!;
  const canvas = (await page.locator('.paper-viewport').boundingBox())!;
  expect(canvas.y + canvas.height).toBeCloseTo(dock.y, 0);
  await expect(page.getByRole('button', { name: '펜', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '문서 메뉴' }).click();
  await expect(page.getByRole('button', { name: '페이지 목록' })).toBeVisible();
  await page.getByRole('button', { name: '페이지 목록' }).click();
  await expect(page.locator('.page-sidebar')).toBeVisible();
  await page.screenshot({ path: '../Notelin-phone-editor.png' });
  await page.setViewportSize({ width: 800, height: 844 });
  await expect(page.locator('html')).toHaveAttribute('data-device-ui', 'tablet');
  await expect(page.locator('.editor-header .editor-page-controls')).toBeVisible();
  await expect(page.locator('.editor-utility [data-action=undo]')).toHaveCount(1);
  await expect(page.locator('.phone-bottom-nav')).toHaveCount(0);
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await expect(page.getByRole('button', { name: '휴대폰 필기 열기' })).toBeVisible();
  expect(errors).toEqual([]);
});

browserTest('Samsung tablet retains its existing chrome in a narrow split window', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173/mynotes/',
    viewport: { width: 600, height: 900 },
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 SamsungBrowser/30.0 Chrome/143.0.0.0 Safari/537.36',
  });
  try {
    await emulateStandalone(context);
    const page = await context.newPage();
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-device-ui', 'tablet');
    await expect(page.locator('.phone-bottom-nav')).toBeHidden();
    await page.getByRole('button', { name: '새 노트', exact: true }).click();
    await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
    await expect(page.locator('.page-loading')).toBeHidden();
    expect((await page.locator('.ink-toolbar').boundingBox())!.height).toBeLessThanOrEqual(44);
    await expect(page.locator('.editor-header .editor-page-controls')).toBeVisible();
  } finally {
    await context.close();
  }
});
