import { test, expect } from '@playwright/test';

test('choose four, five or six notes per row in folders and retain it across navigation and reopening', async ({ page }) => {
  await page.goto('./'); await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['notes', 'pages', 'folders'], 'readwrite');
        tx.objectStore('folders').put({ id: 'density-folder', name: '배치 검사', color: '#5482da' });
        for (let i = 0; i < 12; i++) {
          const id = `density-note-${i}`, pageId = `${id}-page`, now = Date.now() + i;
          tx.objectStore('notes').put({ id, title: `배치 노트 ${i + 1}`, cover: ['#5482da', '#50a08c', '#bd73a4'][i % 3], folderId: 'density-folder', pageIds: [pageId], created: now, updated: now, opened: now, favorite: true, deleted: null });
          tx.objectStore('pages').put({ id: pageId, noteId: id, width: 794, height: 1123, paper: 'lined', paperColor: '#fffefb', spacing: 32, items: [], revision: 0 });
        }
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  await page.reload(); await page.locator('.folder-nav').getByRole('button', { name: '배치 검사 12', exact: true }).click();
  const setting = page.getByRole('combobox', { name: '한 줄 노트 개수', exact: true });
  const firstRow = () => page.locator('#note-results .note-card').evaluateAll(cards => {
    const first = cards[0].getBoundingClientRect().top;
    return cards.filter(card => Math.abs(card.getBoundingClientRect().top - first) < 2).length;
  });
  for (const count of [4, 5, 6]) {
    await setting.selectOption(String(count)); await expect.poll(firstRow).toBe(count);
  }
  await page.screenshot({ path: '../MyNotes-six-columns.png', fullPage: true });
  await page.getByRole('button', { name: '목록 보기', exact: true }).click(); await expect.poll(firstRow).toBe(1);
  await setting.selectOption('5'); await expect.poll(firstRow).toBe(5);
  await page.getByRole('button', { name: '배치 노트 12 열기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await expect(setting).toHaveValue('5'); await expect.poll(firstRow).toBe(5);
  await page.reload(); await expect(setting).toHaveValue('5');
  await page.locator('.folder-nav').getByRole('button', { name: '배치 검사 12', exact: true }).click(); await expect.poll(firstRow).toBe(5);
  await page.setViewportSize({ width: 390, height: 844 }); await setting.selectOption('6');
  await expect.poll(firstRow).toBe(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = (await setting.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await setting.selectOption('auto'); await expect.poll(firstRow).toBe(2);
});
