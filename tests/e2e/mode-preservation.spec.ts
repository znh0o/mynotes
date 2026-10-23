import { test, expect } from './standalone-test';

test('opening an existing note in browser mode shows installation and preserves its data', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('기존 필기 보존');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible();
  const before = await page.evaluate(async () => {
    const open = indexedDB.open('mynotes-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try {
      const get = db.transaction('notes').objectStore('notes').getAll();
      return await new Promise<any[]>((resolve, reject) => { get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
    } finally { db.close(); }
  });
  await page.evaluate(() => sessionStorage.setItem('notelin-e2e-browser', '1'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Notelin 설치하기' })).toBeVisible();
  await expect(page.locator('.library-shell,#paper-live')).toHaveCount(0);
  const after = await page.evaluate(async () => {
    const open = indexedDB.open('mynotes-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try {
      const get = db.transaction('notes').objectStore('notes').getAll();
      return await new Promise<any[]>((resolve, reject) => { get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
    } finally { db.close(); }
  });
  expect(after).toEqual(before);
  await page.evaluate(() => sessionStorage.removeItem('notelin-e2e-browser'));
  await page.reload();
  await expect(page.getByRole('button', { name: '기존 필기 보존 열기' })).toBeVisible();
});
