import { test, expect, type Page } from './standalone-test';
import { selectPen, setInkColor } from './helpers';

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
async function pencilMode(page: Page, mode: 'width' | 'darkness') {
  await page.getByRole('button', { name: /연필 조절 항목:/ }).click();
  await page.locator(`[data-action="pencil-mode"][data-id="${mode}"]`).click();
}

test('each pen restores its last width, color and pencil darkness after switching, typing and reopening', async ({ page }) => {
  await create(page);
  const settings: { label: '볼펜' | '만년필' | '연필' | '형광펜'; tool: string; width: number; color: string }[] = [
    { label: '볼펜', tool: 'pen', width: 2.5, color: '#112233' },
    { label: '만년필', tool: 'fountain', width: 5, color: '#3344aa' },
    { label: '연필', tool: 'pencil', width: 1.5, color: '#445566' },
    { label: '형광펜', tool: 'highlighter', width: 8, color: '#cc5533' },
  ];
  for (const s of settings) {
    if (s.label === '형광펜') await page.getByRole('button', { name: s.label, exact: true }).click();
    else await selectPen(page, s.label);
    await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill(String(s.width));
    await setInkColor(page, s.color);
    if (s.tool === 'pencil') {
      await pencilMode(page, 'darkness');
      await page.getByRole('slider', { name: '연필 진하기' }).fill('45');
    }
  }
  const check = async () => {
    for (const s of settings) {
      if (s.label === '형광펜') await page.getByRole('button', { name: s.label, exact: true }).click();
      else await selectPen(page, s.label);
      const rgb = [1, 3, 5].map(index => parseInt(s.color.slice(index, index + 2), 16));
      await expect(page.locator('#width-preview')).toHaveCSS('background-color', `rgb(${rgb.join(', ')})`);
      if (s.tool === 'pencil') {
        await expect(page.getByRole('button', { name: '연필 조절 항목: 진하기' })).toBeVisible();
        await expect(page.getByRole('slider', { name: '연필 진하기' })).toHaveValue('45');
        await pencilMode(page, 'width');
      }
      await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue(String(s.width));
      if (s.tool === 'pencil') await pencilMode(page, 'darkness');
    }
  };
  await check();
  // The drawing engine, not just the sliders, must use the restored values.
  for (const [index, s] of settings.entries()) {
    if (s.label === '형광펜') await page.getByRole('button', { name: s.label, exact: true }).click();
    else await selectPen(page, s.label);
    const r = (await page.locator('#paper-live').boundingBox())!, scale = r.width / 794, y = r.y + (120 + index * 80) * scale;
    await page.mouse.move(r.x + 100 * scale, y); await page.mouse.down();
    await page.mouse.move(r.x + 280 * scale, y, { steps: 8 }); await page.mouse.up();
  }
  await expect.poll(async () => (await items(page)).length).toBe(4);
  const strokes = await items(page);
  settings.forEach((s, index) => expect(strokes[index]).toMatchObject({ tool: s.tool, color: s.color, width: s.width }));
  expect(strokes[2].pencilDarkness).toBe(.45);
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('slider', { name: '글자 크기', exact: true }).fill('32'); await setInkColor(page, '#aa1122');
  await check();
  // Navigate immediately after changing a control; flush must include preferences.
  await selectPen(page, '볼펜');
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
  await create(page); await selectPen(page, '연필');
  await pencilMode(page, 'darkness');
  await expect(page.getByRole('slider', { name: '연필 진하기' })).toHaveValue('85');
  await pencilMode(page, 'width');
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill('2'); await setInkColor(page, '#776655');
  await page.getByRole('button', { name: '지우개', exact: true }).click();
  await page.getByRole('slider', { name: '지우개 크기' }).fill('65');
  await page.getByRole('button', { name: '펜 지우개', exact: true }).click();
  await selectPen(page, '연필');
  await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('2');
  await expect(page.locator('#width-preview')).toHaveCSS('background-color', 'rgb(119, 102, 85)');
  await page.getByRole('button', { name: '지우개', exact: true }).click();
  await expect(page.getByRole('slider', { name: '지우개 크기' })).toHaveValue('65');
  await expect(page.getByRole('button', { name: '펜 지우개', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('highlighter width has its own thinner, capped range', async ({ page }) => {
  await create(page);
  await selectPen(page, '볼펜');
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill('2.5');
  await page.getByRole('button', { name: '형광펜', exact: true }).click();
  const slider = page.getByRole('slider', { name: '펜 굵기', exact: true });
  await expect(slider).toHaveAttribute('min', '4');
  await expect(slider).toHaveAttribute('max', '32');
  await slider.fill('4');
  const r = (await page.locator('#paper-live').boundingBox())!;
  await page.mouse.move(r.x + 120, r.y + 210); await page.mouse.down();
  await page.mouse.move(r.x + 250, r.y + 210, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await items(page)).length).toBe(1);
  expect((await items(page))[0].width).toBe(4);
  await slider.fill('32');
  await page.mouse.move(r.x + 120, r.y + 260); await page.mouse.down();
  await page.mouse.move(r.x + 250, r.y + 260, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await items(page)).length).toBe(2);
  expect((await items(page))[1].width).toBe(32);
  await selectPen(page, '볼펜');
  await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('2.5');
  await page.getByRole('button', { name: '형광펜', exact: true }).click();
  await expect(slider).toHaveValue('32');
});
