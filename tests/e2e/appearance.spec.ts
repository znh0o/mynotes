import { test, expect } from './standalone-test';

test('appearance follows the device, remembers an override and leaves document colors intact', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '설정 및 백업', exact: true }).click();
  await expect(page.getByRole('button', { name: '기기 설정', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '라이트', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '다크', exact: true }).click();
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: '../Notelin-dark-library.png', fullPage: true });
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('다크 모드 검증');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.locator('.page-sidebar')).toBeHidden();
  const canvas = (await page.locator('#paper-live').boundingBox())!;
  await page.mouse.move(canvas.x + 90, canvas.y + 140); await page.mouse.down();
  await page.mouse.move(canvas.x + 190, canvas.y + 145, { steps: 8 }); await page.mouse.up();
  await page.locator('#save-status').click();
  const savedColors = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('mynotes-v1'); request.onsuccess = () => resolve(request.result); });
    const rows = await new Promise<any[]>(resolve => { const request = db.transaction('pages').objectStore('pages').getAll(); request.onsuccess = () => resolve(request.result); });
    db.close(); return rows.map(p => ({ id: p.id, paperColor: p.paperColor, colors: p.items.map((i: any) => i.color) }));
  });
  const before = await savedColors();
  await page.getByRole('button', { name: '펜', exact: true }).click();
  await page.screenshot({ path: '../Notelin-dark-editor.png' });
  await page.getByRole('button', { name: '펜 메뉴 닫기' }).click();
  await page.getByRole('button', { name: '노트 설정', exact: true }).click();
  await page.getByRole('button', { name: '기기 설정', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '완료', exact: true }).click();
  expect(await savedColors()).toEqual(before);
});

test('page list starts closed on every entry and opens on request at desktop and phone widths', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('페이지 목록 검증');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  const button = page.getByRole('button', { name: '페이지 목록', exact: true });
  const sidebar = page.locator('.page-sidebar');
  for (const width of [1440, 430]) {
    await page.setViewportSize({ width, height: 1080 });
    await expect(sidebar).toBeHidden(); await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click(); await expect(sidebar).toBeVisible(); await expect(button).toHaveAttribute('aria-expanded', 'true');
    await button.click(); await expect(sidebar).toBeHidden();
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  await button.click(); await expect(sidebar).toBeVisible();
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.getByRole('button', { name: '페이지 목록 검증 열기' }).click();
  await expect(sidebar).toBeHidden();
});
