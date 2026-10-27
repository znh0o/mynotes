import { test, expect } from './standalone-test';

test('new note remains usable when a landscape keyboard covers the lower screen', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 875 });
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  const dialog = page.locator('dialog.new-note-dialog');
  const title = dialog.locator('[name=title]');
  await expect(title).not.toBeFocused();
  await dialog.locator('.paper-options label:has(input[value="grid"])').click();
  await expect(dialog.locator('[name=paper][value=grid]')).toBeChecked();
  await title.click();
  await page.evaluate(() => {
    (window as any).__notelinKeyboardInset = 405 * devicePixelRatio;
    (window as any).__notelinKeyboardUsableHeight = 470 * devicePixelRatio;
    dispatchEvent(new Event('notelin-keyboard-inset'));
  });
  await expect(dialog).toHaveClass(/keyboard-open/);
  await expect(dialog.locator('.new-note-options')).toBeVisible();
  await expect(dialog.locator('[name=paper][value=grid]')).toBeChecked();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(470);
  const header = await dialog.locator('header').boundingBox();
  const body = await dialog.locator('.modal-body').boundingBox();
  const footer = await dialog.locator('footer').boundingBox();
  expect(header).not.toBeNull();
  expect(body).not.toBeNull();
  expect(footer).not.toBeNull();
  expect(header!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(body!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
  expect(body!.y + body!.height).toBeLessThanOrEqual(footer!.y + 1);
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
  const bodyScrolls = await dialog.locator('.modal-body').evaluate(el => el.scrollHeight > el.clientHeight);
  expect(bodyScrolls).toBe(true);
  await dialog.locator('[name=size]').scrollIntoViewIfNeeded();
  await expect(dialog.locator('[name=size]')).toBeInViewport();
  await title.fill('키보드 화면 검증');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  const paper = await page.evaluate(async () => {
    const request = indexedDB.open('mynotes-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const note = await new Promise<any>((resolve, reject) => {
      const result = db.transaction('notes').objectStore('notes').getAll();
      result.onsuccess = () => resolve(result.result.find((item: any) => item.title === '키보드 화면 검증'));
      result.onerror = () => reject(result.error);
    });
    const paper = await new Promise<any>((resolve, reject) => {
      const result = db.transaction('pages').objectStore('pages').get(note.pageIds[0]);
      result.onsuccess = () => resolve(result.result.paper);
      result.onerror = () => reject(result.error);
    });
    db.close();
    return paper;
  });
  expect(paper).toBe('grid');
});
