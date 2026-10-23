import { test, expect, type Page } from '@playwright/test';

async function create(page: Page) {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('펜별 설정');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden(); await expect(page.locator('.app-slide-layer')).toHaveCount(0);
}
async function items(page: Page) {
  return page.evaluate(async () => {
    const note = document.querySelector<HTMLElement>('.note-tab.active [data-action=tab]')!.dataset.id;
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    const pages = await new Promise<any[]>(resolve => { const r = db.transaction('pages').objectStore('pages').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return pages.find(p => p.noteId === note)?.items || [];
  });
}

test('each pen restores its last width, color and pencil darkness after switching, typing and reopening', async ({ page }) => {
  await create(page);
  const settings = [
    { label: '볼펜', tool: 'pen', width: 2.5, color: '#112233' },
    { label: '만년필', tool: 'fountain', width: 5, color: '#3344aa' },
    { label: '연필', tool: 'pencil', width: 1.5, color: '#445566' },
    { label: '형광펜', tool: 'highlighter', width: 8, color: '#cc5533' },
  ];
  for (const s of settings) {
    await page.getByRole('button', { name: s.label, exact: true }).click();
    await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill(String(s.width));
    await page.locator('#ink-color').fill(s.color);
    if (s.tool === 'pencil') {
      await page.getByRole('combobox', { name: '연필 조절 항목' }).selectOption('darkness');
      await page.getByRole('slider', { name: '연필 진하기' }).fill('45');
    }
  }
  const check = async () => {
    for (const s of settings) {
      await page.getByRole('button', { name: s.label, exact: true }).click();
      await expect(page.locator('#ink-color')).toHaveValue(s.color);
      if (s.tool === 'pencil') {
        await expect(page.getByRole('combobox', { name: '연필 조절 항목' })).toHaveValue('darkness');
        await expect(page.getByRole('slider', { name: '연필 진하기' })).toHaveValue('45');
        await page.getByRole('combobox', { name: '연필 조절 항목' }).selectOption('width');
      }
      await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue(String(s.width));
      if (s.tool === 'pencil') await page.getByRole('combobox', { name: '연필 조절 항목' }).selectOption('darkness');
    }
  };
  await check();
  // The drawing engine, not just the sliders, must use the restored values.
  for (const [index, s] of settings.entries()) {
    await page.getByRole('button', { name: s.label, exact: true }).click();
    const r = (await page.locator('#paper-live').boundingBox())!, scale = r.width / 794, y = r.y + (120 + index * 80) * scale;
    await page.mouse.move(r.x + 100 * scale, y); await page.mouse.down();
    await page.mouse.move(r.x + 280 * scale, y, { steps: 8 }); await page.mouse.up();
  }
  await expect.poll(async () => (await items(page)).length).toBe(4);
  const strokes = await items(page);
  settings.forEach((s, index) => expect(strokes[index]).toMatchObject({ tool: s.tool, color: s.color, width: s.tool === 'highlighter' ? 40 : s.width }));
  expect(strokes[2].pencilDarkness).toBe(.45);
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('slider', { name: '글자 크기', exact: true }).fill('32'); await page.locator('#ink-color').fill('#aa1122');
  await check();
  // Navigate immediately after changing a control; flush must include preferences.
  await page.getByRole('button', { name: '볼펜', exact: true }).click();
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill('4'); settings[0].width = 4;
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '펜별 설정 열기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden(); await check();
});

test('new profiles preserve legacy pencil darkness and switching through the eraser keeps the pen style', async ({ page }) => {
  await page.goto('./'); await expect(page.locator('#library-title')).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'pencil-darkness', value: .85 }); tx.oncomplete = () => resolve(); }); db.close();
  });
  await create(page); await page.getByRole('button', { name: '연필', exact: true }).click();
  await page.getByRole('combobox', { name: '연필 조절 항목' }).selectOption('darkness');
  await expect(page.getByRole('slider', { name: '연필 진하기' })).toHaveValue('85');
  await page.getByRole('combobox', { name: '연필 조절 항목' }).selectOption('width');
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill('2'); await page.locator('#ink-color').fill('#776655');
  await page.getByRole('button', { name: '지우개', exact: true }).click();
  await page.getByRole('slider', { name: '지우개 크기' }).fill('65');
  await page.getByRole('button', { name: '펜 지우개', exact: true }).click();
  await page.getByRole('button', { name: '연필', exact: true }).click();
  await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('2');
  await expect(page.locator('#ink-color')).toHaveValue('#776655');
  await page.getByRole('button', { name: '지우개', exact: true }).click();
  await expect(page.getByRole('slider', { name: '지우개 크기' })).toHaveValue('65');
  await expect(page.getByRole('button', { name: '펜 지우개', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
