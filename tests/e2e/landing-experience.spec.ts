import { test, expect } from '@playwright/test';

test('iPhone and iPad installation taps open a visible PWA guide while Android keeps the APK route', async ({ browser }) => {
  for (const [device, userAgent] of [
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'],
    ['iPad', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'],
  ] as const) {
    const context = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173/mynotes/', userAgent,
      hasTouch: true, viewport: device === 'iPhone' ? { width: 390, height: 844 } : { width: 1050, height: 800 },
    });
    try {
      if (device === 'iPad') await context.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }));
      const page = await context.newPage(); await page.goto('./');
      const modal = page.getByRole('dialog', { name: 'iPhone · iPad에 설치하기' });
      await expect(page.getByRole('link', { name: 'Android 앱 다운로드' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Mac', exact: true })).toHaveCount(0);
      for (const selector of ['.install-hero [data-download]', '.install-header [data-download]', '#install-guide [data-download]']) {
        const cta = page.locator(selector);
        await expect(cta).toHaveAttribute('href', '#install-guide');
        await cta.tap();
        await expect(modal).toBeVisible();
        await expect(modal).toContainText('홈 화면에 추가');
        await expect(modal.getByRole('heading')).toBeFocused();
        await modal.getByRole('button', { name: '설치 안내 닫기' }).tap();
        await expect(modal).toBeHidden();
      }
      await page.getByRole('button', { name: 'Android', exact: true }).tap();
      await expect(page.getByRole('link', { name: 'Android 앱 다운로드' })).toHaveAttribute('href', 'https://github.com/znh0o/mynotes/releases/latest/download/Notelin.apk');
      expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    } finally { await context.close(); }
  }
  const installed = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173/mynotes/',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  try {
    await installed.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    const page = await installed.newPage(); await page.goto('./');
    await expect(page.locator('.install-page')).toHaveCount(0);
    await expect(page.locator('#library-title')).toContainText('나의 서재');
  } finally { await installed.close(); }
});

test('the site lets a visitor sketch, undo, erase and inspect a current app screen', async ({ page }) => {
  await page.goto('./');
  const paper = page.locator('.install-demo-surface'); await paper.scrollIntoViewIfNeeded();
  const draw = async () => {
    await paper.scrollIntoViewIfNeeded();
    const box = await paper.boundingBox(); if (!box) throw new Error('demo paper missing');
    const x = box.x + box.width * .25, y = box.y + box.height * .4;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 90, y + 35, { steps: 10 }); await page.mouse.up();
    return { x, y };
  };
  await draw();
  await expect(page.locator('[data-demo-ink] path')).toHaveCount(1);
  await page.getByRole('button', { name: '체험 실행 취소' }).click();
  await expect(page.locator('[data-demo-ink] path')).toHaveCount(0);
  await page.getByRole('button', { name: '체험 형광펜' }).click();
  await draw();
  await expect(page.locator('[data-demo-ink] path')).toHaveAttribute('opacity', '.3');
  await page.getByRole('button', { name: '체험 지우개' }).click();
  await paper.scrollIntoViewIfNeeded();
  const box = await paper.boundingBox(); if (!box) throw new Error('demo paper missing');
  const x = box.x + box.width * .25, y = box.y + box.height * .4;
  await page.mouse.move(x + 45, y + 18); await page.mouse.down(); await page.mouse.up();
  await expect(page.locator('[data-demo-ink] path')).toHaveCount(0);
  await page.getByRole('tab', { name: 'PDF 공부' }).click();
  await page.getByRole('button', { name: '미리보기 크게 보기' }).click();
  const modal = page.getByRole('dialog', { name: '앱 화면 크게 보기' });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('img')).toHaveAttribute('src', /notelin-pdf-preview\.webp$/);
  await modal.getByRole('button', { name: '미리보기 닫기' }).click();
  await expect(modal).toBeHidden();
  await page.getByRole('searchbox', { name: '도움말 검색' }).fill('기본 PDF');
  await expect(page.getByText('PDF를 Notelin에서 바로 열 수 있나요?')).toBeVisible();
  await expect(page.getByText('어떤 기기에서 사용할 수 있나요?')).toBeHidden();
});

test('mobile navigation opens without covering the Android download action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('./');
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  await expect(page.locator('.install-nav')).toHaveClass(/is-open/);
  await expect(page.getByRole('link', { name: 'Android 앱 다운로드' })).toBeVisible();
  await page.locator('.install-nav').getByRole('link', { name: '직접 써보기' }).click();
  await expect(page.locator('.install-nav')).not.toHaveClass(/is-open/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
