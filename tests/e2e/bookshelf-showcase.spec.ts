import { test, expect } from './standalone-test';

test('bookshelf visual review', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#library-title')).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    const sourceNote = await new Promise<any>(resolve => { const r = db.transaction('notes').objectStore('notes').getAll(); r.onsuccess = () => resolve(r.result[0]); });
    const sourcePage = await new Promise<any>(resolve => { const r = db.transaction('pages').objectStore('pages').getAll(); r.onsuccess = () => resolve(r.result[0]); });
    const folders = [
      ['국어', ['고1 9월 모의고사', '중간 문법 추가 프린트', '국어 필기', '고전 문학 정리', '비문학 독해']],
      ['수학', ['수학 정리', '수학 문제', '오답노트', '기하와 벡터']],
      ['영어', ['영어 단어', '영어 문법', '독해 연습']],
      ['과학', ['과학 개념', '실험 노트', '통합과학 핵심']]
    ] as const;
    const tx = db.transaction(['folders', 'notes', 'pages'], 'readwrite');
    for (const [name, titles] of folders) {
      const folderId = crypto.randomUUID();
      tx.objectStore('folders').put({ id: folderId, name, color: '#9eb5d2' });
      for (const title of titles) {
        const id = crypto.randomUUID(), pageId = crypto.randomUUID();
        tx.objectStore('notes').put({ ...sourceNote, id, title, folderId, pageIds: [pageId], opened: Date.now(), updated: Date.now(), created: Date.now(), thumbnail: undefined });
        tx.objectStore('pages').put({ ...sourcePage, id: pageId, noteId: id, items: [] });
      }
    }
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
    db.close();
  });
  await page.reload();
  await page.locator('[data-action=library-mode][data-id=bookshelf]').click();
  await expect(page.locator('.book-spine')).toHaveCount(16);
  await page.screenshot({ path: '../Notelin-bookshelf-showcase.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '사용자 지정', exact: true }).click();
  await page.locator('.book-spine').nth(2).click();
  await page.screenshot({ path: '../Notelin-bookshelf-custom.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '최근순', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '../Notelin-bookshelf-dark.png', fullPage: true, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../Notelin-bookshelf-phone.png', fullPage: true, animations: 'disabled' });
});
