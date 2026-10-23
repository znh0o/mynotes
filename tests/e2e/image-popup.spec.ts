import { test, expect } from './standalone-test';
import sharp from 'sharp';

test('image popup inserts a chosen photo immediately or at a tapped position', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('사진 팝업 검증');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  const photo = { name: 'sample.png', mimeType: 'image/png',
    buffer: await sharp({ create: { width: 320, height: 200, channels: 4, background: '#ce5873' } }).png().toBuffer() };
  const images = () => page.evaluate(async () => {
    const open = indexedDB.open('mynotes-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try {
      const get = db.transaction('pages').objectStore('pages').getAll();
      const pages = await new Promise<any[]>((resolve, reject) => { get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
      return pages.flatMap(page => page.items).filter(item => item.kind === 'image');
    } finally { db.close(); }
  });
  const imageButton = page.getByRole('button', { name: '이미지', exact: true });
  await imageButton.click();
  const picker = page.getByRole('dialog', { name: '사진 추가' });
  await expect(picker).toBeVisible();
  await page.screenshot({ path: '../Notelin-image-popup.png' });
  const firstChoice = page.waitForEvent('filechooser');
  await picker.getByRole('button', { name: /사진 선택/ }).click();
  await (await firstChoice).setFiles(photo);
  await expect.poll(async () => (await images()).length).toBe(1);
  const centered = (await images())[0];
  expect(centered.x).toBeGreaterThan(0);
  expect(centered.y).toBeGreaterThan(0);
  await imageButton.click();
  await picker.getByRole('button', { name: /위치 지정/ }).click();
  await expect(picker).toBeHidden();
  const canvas = (await page.locator('#paper-live').boundingBox())!;
  const secondChoice = page.waitForEvent('filechooser');
  await page.mouse.click(canvas.x + 55, canvas.y + 85);
  await (await secondChoice).setFiles(photo);
  await expect.poll(async () => (await images()).length).toBe(2);
  expect((await images())[1].x).toBeLessThan(centered.x);
});
