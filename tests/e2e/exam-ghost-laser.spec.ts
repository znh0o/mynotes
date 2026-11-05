import { test, expect, type Page } from './standalone-test';

async function newNote(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('시험 모드 검증');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.locator('.app-slide-layer')).toHaveCount(0);
}

async function line(page: Page, y: number) {
  const box = (await page.locator('#paper-live').boundingBox())!;
  const scale = box.width / 794;
  await page.mouse.move(box.x + 100 * scale, box.y + y * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 280 * scale, box.y + y * scale, { steps: 12 });
  await page.mouse.up();
}

async function items(page: Page) {
  return page.evaluate(async () => {
    const noteId = document.querySelector<HTMLElement>('.note-tab.active [data-action=tab]')!.dataset.id;
    const database = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('mynotes-v1'); request.onsuccess = () => resolve(request.result);
    });
    const pages = await new Promise<any[]>(resolve => {
      const request = database.transaction('pages').objectStore('pages').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return pages.filter(page => page.noteId === noteId).flatMap(page => page.items);
  });
}

test('ghost pen stays faint at width 1.0 and keeps its own chosen color', async ({ page }) => {
  await newNote(page);
  await page.getByRole('button', { name: '펜', exact: true }).click();
  await page.locator('.pen-preset-row[data-id="starter-2"]').click();
  await page.getByRole('button', { name: '고스트 펜', exact: true }).click();
  await expect(page.getByRole('slider', { name: '고스트 펜 굵기 고정' })).toBeDisabled();
  await expect(page.locator('#width-value')).toHaveText('1.0');
  await page.locator('[data-action=color][data-id="#cf7d85"]').click();
  await line(page, 185);
  await expect.poll(async () => (await items(page)).length).toBe(1);
  expect((await items(page))[0]).toMatchObject({ ghost: true, tool: 'pen', width: 1, color: '#cf7d85' });

  await page.getByRole('button', { name: '펜', exact: true }).click();
  await page.locator('.pen-preset-row[data-id="starter-2"]').click();
  await line(page, 245);
  await expect.poll(async () => (await items(page)).length).toBe(2);
  expect((await items(page))[1]).toMatchObject({ tool: 'pencil', width: 3, color: '#30445e' });

  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.locator('.note-open').first().click();
  await expect(page.locator('.page-loading')).toBeHidden();
  await page.getByRole('button', { name: '고스트 펜', exact: true }).click();
  await expect(page.locator('[data-action=color][data-id="#cf7d85"]')).toHaveClass(/active/);
  await expect(page.locator('#width-value')).toHaveText('1.0');
});

test('ghost eraser is isolated, laser is temporary, and exam presets reopen', async ({ page }) => {
  await newNote(page);
  await line(page, 175);
  await page.getByRole('button', { name: '고스트 펜', exact: true }).click();
  await line(page, 235);
  await expect.poll(async () => (await items(page)).length).toBe(2);
  expect((await items(page)).some(item => item.ghost === true)).toBe(true);

  await page.getByRole('button', { name: '고스트 지우개', exact: true }).click();
  await expect(page.getByRole('button', { name: '고스트 지우개', exact: true }).locator('.ghost-eraser-mark')).toHaveText('G');
  const box = (await page.locator('#paper-live').boundingBox())!, scale = box.width / 794;
  await page.mouse.move(box.x + 180 * scale, box.y + 150 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 180 * scale, box.y + 260 * scale, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await items(page)).length).toBe(1);
  expect((await items(page))[0].ghost).toBeUndefined();

  await page.getByRole('button', { name: '레이저 포인터', exact: true }).click();
  await expect(page.locator('.laser-overlay')).toBeVisible();
  const laser = (await page.locator('.laser-overlay').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const alphaAt = (x: number, y: number) => page.locator('.laser-overlay').evaluate((canvas, point) => {
    const element = canvas as HTMLCanvasElement, rect = element.getBoundingClientRect();
    return element.getContext('2d')!.getImageData(
      Math.floor((point.x - rect.left) * element.width / rect.width),
      Math.floor((point.y - rect.top) * element.height / rect.height), 1, 1).data[3];
  }, { x, y });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: laser.x + 100, y: laser.y + 100 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: laser.x + 180, y: laser.y + 125 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await alphaAt(laser.x + 180, laser.y + 125)).toBe(0);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, x: laser.x + 100, y: laser.y + 100, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', button: 'left', buttons: 1, x: laser.x + 220, y: laser.y + 130 });
  await expect.poll(() => alphaAt(laser.x + 220, laser.y + 130), { timeout: 1000 }).toBeGreaterThan(0);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, x: laser.x + 220, y: laser.y + 130, clickCount: 1 });
  await cdp.detach();
  expect(await items(page)).toHaveLength(1);

  const timerIcon = await page.getByRole('button', { name: '타이머', exact: true }).locator('svg').innerHTML();
  const examIcon = await page.getByRole('button', { name: '시험 모드', exact: true }).locator('svg').innerHTML();
  expect(timerIcon).not.toBe(examIcon);
  await expect(page.getByRole('button', { name: '시험 모드', exact: true }).locator('.exam-entry-label')).toHaveText('시험');
  await page.getByRole('button', { name: '시험 모드', exact: true }).click();
  const setup = page.getByRole('dialog', { name: '시험 모드' });
  await setup.locator('[name=exam-name]').fill('국어 모의고사');
  await setup.locator('[name=exam-minutes]').fill('30');
  await setup.getByRole('button', { name: '시험 시작' }).click();
  await expect(page.locator('.editor-shell')).toHaveClass(/exam-active/);
  await expect(page.getByRole('toolbar', { name: '시험 모드 도구' })).toBeVisible();
  await expect(page.locator('.ink-toolbar')).toBeHidden();
  await expect(page.locator('.laser-overlay')).toBeHidden();
  await expect(page.getByRole('button', { name: '연필', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '지우개', exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toContainText(/(?:30|29):\d{2}/);
  await line(page, 310);
  await expect.poll(async () => (await items(page)).length).toBe(2);
  expect((await items(page)).at(-1).tool).toBe('pencil');
  await page.getByRole('button', { name: '지우개', exact: true }).click();
  const examBox = (await page.locator('#paper-live').boundingBox())!, examScale = examBox.width / 794;
  await page.mouse.move(examBox.x + 180 * examScale, examBox.y + 310 * examScale);
  await page.mouse.down(); await page.mouse.move(examBox.x + 210 * examScale, examBox.y + 310 * examScale, { steps: 3 }); await page.mouse.up();
  await expect.poll(async () => (await items(page)).length).toBe(1);
  await page.getByRole('button', { name: '나가기', exact: true }).click();
  await expect(page.locator('.editor-shell')).not.toHaveClass(/exam-active/);
  await page.getByRole('button', { name: '시험 모드', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '시험 모드' }).getByText('국어 모의고사')).toBeVisible();
});

test('finger pan keeps working after laser contact, pen hover, and tool changes', async ({ page, context }) => {
  await newNote(page);
  await page.getByRole('button', { name: '레이저 포인터', exact: true }).click();
  await expect(page.locator('.laser-overlay')).toHaveCSS('pointer-events', 'none');
  await page.getByRole('button', { name: '보기 옵션', exact: true }).click();
  for (let index = 0; index < 3; index++) await page.locator('#view-options-panel [data-action=zoom-in]').click();
  await page.getByRole('button', { name: '보기 옵션', exact: true }).click();
  const viewport = page.locator('.paper-viewport');
  await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(180);
  const rect = (await viewport.boundingBox())!;
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, force: .5, x, y, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, force: 0, x, y, clickCount: 1 });
  const pan = async (id: number) => {
    const before = await viewport.evaluate(el => { el.scrollTop = 140; return el.scrollTop; });
    const contact = (offset: number) => ({ id, x, y: y + offset, radiusX: 15, radiusY: 15, force: .5 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact(55)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact(-70)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(before + 50);
  };
  await pan(1);
  await page.getByRole('button', { name: '형광펜', exact: true }).click();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', buttons: 0, force: 0, x, y });
  await pan(2);
  await cdp.detach();
});
