import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
test.use({ reducedMotion: 'no-preference' });

async function back(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true }); history.back();
  }));
}

test('back stays inside the app from settings, filters, folders and the home screen', async ({ page }) => {
  await page.goto('./'); await expect(page.locator('#library-title')).toContainText('나의 서재');
  await page.evaluate(() => (window as any).appSession = 'same-document');
  await page.getByRole('button', { name: '설정 및 백업', exact: true }).click(); await expect(page.locator('dialog')).toBeVisible();
  await back(page); await expect(page.locator('dialog')).toHaveCount(0); await expect(page.locator('#library-title')).toContainText('나의 서재');
  for (const [id, title] of [['favorites', '즐겨찾기'], ['recent', '최근 사용한 노트'], ['trash', '휴지통']]) {
    await page.locator(`.library-sidebar [data-id=${id}]`).click(); await expect(page.locator('#library-title')).toContainText(title);
    await back(page); await expect(page.locator('#library-title')).toContainText('나의 서재');
  }
  await page.getByRole('button', { name: '새 폴더 만들기', exact: true }).click(); await page.locator('[name=name]').fill('탐색 검증');
  await page.getByRole('button', { name: '폴더 만들기', exact: true }).click();
  await page.locator('.folder-nav .nav-item').filter({ hasText: '탐색 검증' }).click(); await expect(page.locator('#library-title')).toContainText('탐색 검증');
  await back(page); await expect(page.locator('#library-title')).toContainText('나의 서재');
  for (let i = 0; i < 4; i++) { await back(page); await expect(page.locator('#library-title')).toContainText('나의 서재'); }
  expect(await page.evaluate(() => (window as any).appSession)).toBe('same-document');
  expect(new URL(page.url()).pathname).toBe('/mynotes/');
  // Native dialog cancel (Escape / mobile dialog Back) must not leave a stale entry.
  await page.getByRole('button', { name: '설정 및 백업', exact: true }).click();
  await expect(page.locator('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0); await back(page); await expect(page.locator('#library-title')).toContainText('나의 서재');
  await page.getByRole('button', { name: 'Notelin 시작 가이드 메뉴', exact: true }).click();
  await expect(page.locator('.context-menu')).toBeVisible(); await back(page);
  await expect(page.locator('.context-menu')).toHaveCount(0); await expect(page.locator('#library-title')).toContainText('나의 서재');
});

test('mobile Back closes the navigation drawer before returning home', async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 1000 }); await page.goto('./');
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await expect(page.locator('.library-sidebar')).toHaveClass(/mobile-open/); await back(page);
  await expect(page.locator('.library-sidebar')).not.toHaveClass(/mobile-open/);
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.locator('.library-sidebar [data-id=favorites]').click(); await expect(page.locator('#library-title')).toContainText('즐겨찾기');
  await back(page); await expect(page.locator('#library-title')).toContainText('나의 서재');
});

test('editor returns to the library with a slide and Back works after switching note tabs', async ({ page }) => {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click(); await page.locator('[name=title]').fill('뒤로가기 필기');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click(); await expect(page.locator('#app .page-loading')).toBeHidden();
  const canvas = (await page.locator('#paper-live').boundingBox())!;
  await page.mouse.move(canvas.x + 100, canvas.y + 180); await page.mouse.down(); await page.mouse.move(canvas.x + 240, canvas.y + 180, { steps: 10 }); await page.mouse.up();
  const slide = page.waitForSelector('.app-slide-layer[data-direction=back]', { state: 'attached' });
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await slide; await expect(page.locator('#library-title')).toContainText('나의 서재'); await expect(page.locator('.app-slide-layer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Notelin 시작 가이드 열기', exact: true }).click(); await expect(page.locator('#app .page-loading')).toBeHidden();
  await page.locator('.open-tabs').getByRole('button', { name: '뒤로가기 필기', exact: true }).click();
  await expect(page.locator('#app .page-loading')).toBeHidden();
  await back(page); await expect(page.locator('#library-title')).toContainText('나의 서재');
  await back(page); await expect(page.locator('#library-title')).toContainText('나의 서재');
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open('mynotes-v1'); req.onsuccess = () => resolve(req.result); });
    const pages = await new Promise<any[]>(resolve => { const req = db.transaction('pages').objectStore('pages').getAll(); req.onsuccess = () => resolve(req.result); });
    db.close(); return pages.filter(p => p.items.length === 1 && p.items[0].kind === 'stroke');
  });
  expect(saved).toHaveLength(1);
});

test('imported PDF automatically shows distinct real page thumbnails in the sidebar', async ({ page }) => {
  await page.goto('./'); const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const colors = [rgb(.86, .22, .3), rgb(.18, .36, .87), rgb(.17, .64, .45)];
  for (let i = 0; i < 3; i++) {
    const p = doc.addPage([600, 800]); p.drawRectangle({ x: 100, y: 200, width: 400, height: 400, color: colors[i] });
    p.drawText(`PAGE ${i + 1}`, { x: 110, y: 650, size: 28, font });
  }
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'PDF 가져오기', exact: true }).click();
  await (await chooser).setFiles({ name: '미리보기 검증.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#app .page-loading')).toBeHidden();
  await expect(page.locator('#page-thumbnails img')).toHaveCount(3, { timeout: 15000 });
  const previews = await page.locator('#page-thumbnails img').evaluateAll((images: HTMLImageElement[]) => images.map(i => ({ src: i.src, width: i.naturalWidth })));
  expect(new Set(previews.map(p => p.src)).size).toBe(3); expect(previews.every(p => p.width > 0)).toBe(true);
  await page.locator('#page-thumbnails').getByRole('button', { name: '2페이지', exact: true }).click();
  await expect(page.locator('.page-position')).toHaveText('2 / 3'); await expect(page.locator('#app .page-loading')).toBeHidden();
  const center = await page.locator('#paper-background').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data]);
  expect(center[2]).toBeGreaterThan(center[0] * 2);
  await page.screenshot({ path: '../MyNotes-pdf-sidebar.png' });
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click(); await expect(page.locator('#library-title')).toBeVisible();
  await page.getByRole('button', { name: '미리보기 검증 열기', exact: true }).click();
  await expect(page.locator('#app .page-loading')).toBeHidden(); await expect(page.locator('#page-thumbnails img')).toHaveCount(3);
});
