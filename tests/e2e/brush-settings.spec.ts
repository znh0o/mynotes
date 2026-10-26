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
async function savedPens(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    const collection = await new Promise<any>(resolve => { const r = db.transaction('settings').objectStore('settings').get('pen-presets'); r.onsuccess = () => resolve(r.result?.value); });
    db.close(); return collection;
  });
}
async function pencilMode(page: Page, mode: 'width' | 'darkness') {
  await page.getByRole('button', { name: /연필 조절 항목:/ }).click();
  await page.locator(`[data-action="pencil-mode"][data-id="${mode}"]`).click();
}

test('saved pens change only in the edit view; toolbar adjustments affect the current stroke', async ({ page }) => {
  await create(page);
  await selectPen(page, '볼펜');
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill('4');
  await setInkColor(page, '#112233');
  const r = (await page.locator('#paper-live').boundingBox())!;
  await page.mouse.move(r.x + 100, r.y + 140); await page.mouse.down();
  await page.mouse.move(r.x + 220, r.y + 140, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await items(page)).length).toBe(1);
  expect((await items(page))[0]).toMatchObject({ tool: 'pen', width: 4, color: '#112233' });
  await selectPen(page, '연필'); await selectPen(page, '볼펜');
  await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('3');
  await expect(page.locator('#width-preview')).toHaveCSS('background-color', 'rgb(48, 68, 94)');

  await page.getByRole('button', { name: '펜', exact: true }).click();
  const pens = page.getByRole('dialog', { name: '펜 선택' });
  await pens.getByRole('button', { name: '구성 편집' }).click();
  await pens.getByRole('button', { name: '볼펜 수정' }).click();
  await pens.locator('#pen-edit-width').fill('5.5');
  await pens.locator('[data-action=pen-color]').click();
  const picker = page.getByRole('dialog', { name: '색상 선택' });
  await picker.getByRole('textbox', { name: 'HEX 색상 코드' }).fill('#3344AA');
  await picker.getByRole('button', { name: '이 색 사용' }).click();
  await pens.getByRole('button', { name: '펜 저장' }).click();
  await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('5.5');
  await pens.getByRole('button', { name: '펜 메뉴 닫기' }).click();
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill('2');
  await setInkColor(page, '#aa1122');
  await expect(page.locator('.custom-color')).toHaveClass(/active/);
  await expect.poll(async () => (await savedPens(page)).presets.find((pen: any) => pen.name === '볼펜').color).toBe('#3344aa');
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '펜별 설정 열기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('5.5');
  await expect(page.locator('#width-preview')).toHaveCSS('background-color', 'rgb(51, 68, 170)');
  await expect(page.locator('.custom-color')).toHaveClass(/active/);
  const reopened = (await page.locator('#paper-live').boundingBox())!;
  await page.mouse.move(reopened.x + 100, reopened.y + 220); await page.mouse.down();
  await page.mouse.move(reopened.x + 220, reopened.y + 220, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await items(page)).length).toBe(2);
  expect((await items(page))[1]).toMatchObject({ tool: 'pen', width: 5.5, color: '#3344aa' });
});

test('legacy pencil darkness survives while temporary pencil changes reset after switching tools', async ({ page }) => {
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
  await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('3');
  await expect(page.locator('#width-preview')).toHaveCSS('background-color', 'rgb(48, 68, 94)');
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
  await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: '형광펜', exact: true }).click();
  await expect(slider).toHaveValue('32');
});
