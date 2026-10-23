import { test, expect } from './standalone-test';

test('shape picker draws each shape and remembers the document selection', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('도형 선택 검증');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  const shapeButton = page.getByRole('button', { name: '도형', exact: true });
  const choices = [
    { label: '사각형', shape: 'rect' },
    { label: '원 · 타원', shape: 'ellipse' },
    { label: '직선', shape: 'line' },
    { label: '삼각형', shape: 'triangle' },
  ];
  const items = async () => page.evaluate(async () => {
    const request = indexedDB.open('mynotes-v1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = db.transaction('pages'); const get = transaction.objectStore('pages').getAll();
      const pages = await new Promise<any[]>((resolve, reject) => { get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
      return pages.flatMap(p => p.items).filter(i => i.kind === 'shape');
    } finally { db.close(); }
  });
  for (const [index, choice] of choices.entries()) {
    await shapeButton.click();
    const picker = page.getByRole('dialog', { name: '도형 선택' });
    await expect(picker).toBeVisible();
    await expect(picker).not.toContainText('사각형');
    await expect(picker.getByRole('button', { name: choice.label })).toHaveAttribute('aria-pressed', index === 0 ? 'true' : 'false');
    if (index === 0) await page.screenshot({ path: '../Notelin-shape-popup.png' });
    await picker.getByRole('button', { name: choice.label }).click();
    await expect(picker).toBeHidden();
    await expect(shapeButton).toHaveAttribute('title', `도형 · ${choice.label}`);
    const rect = (await page.locator('#paper-live').boundingBox())!;
    const y = rect.y + 130 + index * 100;
    await page.mouse.move(rect.x + 140, y);
    await page.mouse.down();
    await page.mouse.move(rect.x + 280, y + 65, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await items()).length).toBe(index + 1);
    expect((await items())[index].shape).toBe(choice.shape);
  }
  await page.reload();
  await page.getByRole('button', { name: '도형 선택 검증 열기' }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  await expect(shapeButton).toHaveAttribute('title', '도형 · 삼각형');
  await shapeButton.click();
  await expect(page.getByRole('dialog', { name: '도형 선택' }).getByRole('button', { name: '삼각형' })).toHaveAttribute('aria-pressed', 'true');
  await shapeButton.click();
  await page.setViewportSize({ width: 800, height: 1000 });
  await shapeButton.click();
  const popup = (await page.getByRole('dialog', { name: '도형 선택' }).boundingBox())!;
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(800);
});
