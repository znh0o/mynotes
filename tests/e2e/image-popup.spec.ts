import { test, expect } from './standalone-test';
import sharp from 'sharp';

test.use({ hasTouch: true });

test('only the popup inserts photos and image mode supports touch selection, move, resize and undo', async ({ page, context }) => {
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
  let unexpectedChooser = false;
  page.on('filechooser', () => { unexpectedChooser = true; });
  const canvas = (await page.locator('#paper-live').boundingBox())!;
  const scale = canvas.width / 794;
  const point = (x: number, y: number) => ({ x: canvas.x + x * scale, y: canvas.y + y * scale });
  await page.touchscreen.tap(canvas.x + 30, canvas.y + 60);
  await expect(page.locator('.selection-toolbar')).toBeHidden();
  expect(unexpectedChooser).toBe(false);
  expect(await images()).toHaveLength(1);
  await page.touchscreen.tap(point(centered.x + centered.w / 2, centered.y + centered.h / 2).x,
    point(centered.x + centered.w / 2, centered.y + centered.h / 2).y);
  await expect(page.locator('.selection-toolbar')).toBeVisible();
  const touch = await context.newCDPSession(page);
  const center = point(centered.x + centered.w / 2, centered.y + centered.h / 2);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x, y: center.y, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + 40, y: center.y + 30, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await images())[0].x).toBeGreaterThan(centered.x + 20);
  const moved = (await images())[0];
  expect(moved.y).toBeGreaterThan(centered.y);
  const corner = point(moved.x + moved.w, moved.y + moved.h);
  await page.mouse.move(corner.x, corner.y); await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await images())[0].w).toBeGreaterThan(moved.w);
  const resized = (await images())[0];
  expect(resized.w / resized.h).toBeCloseTo(centered.w / centered.h, 5);
  await page.screenshot({ path: '../Notelin-image-resize.png' });
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)' }).click();
  await expect.poll(async () => (await images())[0].w).toBeCloseTo(moved.w);
  await page.getByRole('button', { name: '다시 실행 (Ctrl+Shift+Z)' }).click();
  await expect.poll(async () => (await images())[0].w).toBeCloseTo(resized.w);
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.getByRole('button', { name: '사진 팝업 검증 열기' }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  expect((await images())[0]).toMatchObject({ x: resized.x, y: resized.y, w: resized.w, h: resized.h });
  await imageButton.click();
  await page.getByRole('button', { name: '사진 팝업 닫기' }).click();
  const reloadedCanvas = (await page.locator('#paper-live').boundingBox())!;
  await page.touchscreen.tap(reloadedCanvas.x + (resized.x + resized.w / 2) * reloadedCanvas.width / 794,
    reloadedCanvas.y + (resized.y + resized.h / 2) * reloadedCanvas.height / 1123);
  await expect(page.locator('.selection-toolbar')).toBeVisible();
  expect(unexpectedChooser).toBe(false);
});
