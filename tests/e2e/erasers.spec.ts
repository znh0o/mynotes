import { test, expect, type Page, type CDPSession } from '@playwright/test';
test.use({ hasTouch: true });

async function start(page: Page) {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('지우개 검증');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden(); await expect(page.locator('.app-slide-layer')).toHaveCount(0);
}
async function pen(page: Page, cdp: CDPSession, type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number, buttons = 1, force = .5, button: 'left' | 'right' = 'left') {
  const r = (await page.locator('#paper-live').boundingBox())!, scale = r.width / 794;
  await cdp.send('Input.dispatchMouseEvent', { type, pointerType: 'pen', button, buttons, force, x: r.x + x * scale, y: r.y + y * scale });
}
async function line(page: Page, cdp: CDPSession, y: number) {
  await pen(page, cdp, 'mousePressed', 100, y);
  for (let x = 110; x <= 400; x += 10) await pen(page, cdp, 'mouseMoved', x, y);
  await pen(page, cdp, 'mouseReleased', 400, y, 0, 0);
}
async function saved(page: Page) {
  return page.evaluate(async () => {
    const noteId = document.querySelector<HTMLElement>('.note-tab.active [data-action=tab]')!.dataset.id;
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    const pages = await new Promise<any[]>(resolve => { const r = db.transaction('pages').objectStore('pages').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return pages.find(p => p.noteId === noteId)?.items || [];
  });
}

test('eraser tap offers both modes, partial erases only the crossing and settings survive reopening', async ({ page, context }) => {
  await start(page); const cdp = await context.newCDPSession(page); await line(page, cdp, 180); await line(page, cdp, 240);
  await page.getByRole('button', { name: '지우개', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '지우개 설정' })).toBeVisible();
  await expect(page.getByRole('button', { name: '스트로크 지우개', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('slider', { name: '지우개 크기' }).fill('30');
  await page.getByRole('button', { name: '펜 지우개', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '지우개 설정' })).toHaveCount(0);
  await pen(page, cdp, 'mousePressed', 250, 160); await pen(page, cdp, 'mouseMoved', 250, 200); await pen(page, cdp, 'mouseReleased', 250, 200, 0, 0);
  await expect.poll(async () => (await saved(page)).length).toBe(3);
  const partial = (await saved(page)).filter((s: any) => Math.abs(s.points[0].y - 180) < .1);
  expect(partial).toHaveLength(2); expect(Math.max(...partial[0].points.map((p: any) => p.x))).toBeLessThan(250);
  expect(Math.min(...partial[1].points.map((p: any) => p.x))).toBeGreaterThan(250);
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '지우개 검증 열기', exact: true }).click(); await expect(page.locator('.page-loading')).toBeHidden();
  await page.getByRole('button', { name: '지우개', exact: true }).click();
  await expect(page.getByRole('button', { name: '펜 지우개', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('slider', { name: '지우개 크기' })).toHaveValue('30');
  await page.getByRole('button', { name: '스트로크 지우개', exact: true }).click();
  await pen(page, cdp, 'mousePressed', 250, 225); await pen(page, cdp, 'mouseMoved', 250, 255); await pen(page, cdp, 'mouseReleased', 250, 255, 0, 0);
  await expect.poll(async () => (await saved(page)).length).toBe(2);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await expect.poll(async () => (await saved(page)).length).toBe(3);
  await page.getByRole('button', { name: '지우개', exact: true }).click(); await page.goBack();
  await expect(page.getByRole('dialog', { name: '지우개 설정' })).toHaveCount(0); await expect(page.locator('#paper-live')).toBeVisible();
  await cdp.detach();
});

test('barrel button erases immediately and releasing it restores the selected pencil', async ({ page, context }) => {
  await start(page); const cdp = await context.newCDPSession(page); await line(page, cdp, 180);
  await page.getByRole('button', { name: '연필', exact: true }).click();
  await pen(page, cdp, 'mousePressed', 250, 150, 2, .5, 'right');
  await pen(page, cdp, 'mouseMoved', 250, 205, 2, .5, 'right');
  await pen(page, cdp, 'mouseReleased', 250, 205, 0, 0, 'right');
  await expect.poll(async () => (await saved(page)).length).toBe(0);
  await expect(page.getByRole('button', { name: '연필', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await line(page, cdp, 280); await expect.poll(async () => (await saved(page)).length).toBe(1);
  expect((await saved(page))[0].tool).toBe('pencil');
  // Holding the barrel before touching the paper produces chorded moves.
  await pen(page, cdp, 'mousePressed', 250, 280, 2, 0, 'right');
  await pen(page, cdp, 'mouseMoved', 260, 280, 2, 0, 'right');
  expect((await saved(page))).toHaveLength(1);
  await pen(page, cdp, 'mouseMoved', 250, 280, 2, .5, 'right');
  await pen(page, cdp, 'mouseMoved', 250, 290, 2, 0, 'right');
  await pen(page, cdp, 'mouseReleased', 250, 290, 0, 0, 'right');
  await expect.poll(async () => (await saved(page)).length).toBe(0);
  await line(page, cdp, 350); await expect.poll(async () => (await saved(page)).length).toBe(1);
  expect((await saved(page))[0].tool).toBe('pencil'); await cdp.detach();
});

test('mid-contact button transitions do not connect across erased ink or erase on hover', async ({ page, context }) => {
  await start(page); const cdp = await context.newCDPSession(page); await line(page, cdp, 180);
  await page.locator('#paper-live').evaluate(canvas => canvas.addEventListener('pointerdown', event => { (window as any).penId = (event as PointerEvent).pointerId; }, { once: true }));
  await pen(page, cdp, 'mousePressed', 100, 280);
  await page.locator('#paper-live').evaluate((canvas: HTMLCanvasElement) => {
    const r = canvas.getBoundingClientRect(), scale = r.width / 794;
    const send = (type: string, x: number, y: number, buttons: number, pressure = .5) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'pen', pointerId: (window as any).penId, buttons, button: -1, pressure, clientX: r.x + x * scale, clientY: r.y + y * scale }));
    send('pointermove', 160, 280, 1);
    send('pointermove', 250, 170, 3); send('pointermove', 250, 200, 3);
    send('pointermove', 300, 280, 1); send('pointermove', 400, 280, 1);
  });
  await pen(page, cdp, 'mouseReleased', 400, 280, 0, 0);
  await expect.poll(async () => (await saved(page)).length).toBe(2);
  const items = await saved(page);
  expect(items[0].points.every((p: any) => p.x <= 160.1 && Math.abs(p.y - 280) < .1)).toBe(true);
  expect(items[1].points.every((p: any) => p.x >= 299.9 && Math.abs(p.y - 280) < .1)).toBe(true);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1); expect((await saved(page))[0].points[0].y).toBeCloseTo(180, 1);
  await page.locator('#paper-live').evaluate((canvas: HTMLCanvasElement) => {
    const r = canvas.getBoundingClientRect(), scale = r.width / 794;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'pen', pointerId: 77, button: 2, buttons: 2, pressure: 0, clientX: r.x + 250 * scale, clientY: r.y + 180 * scale }));
  });
  expect((await saved(page))).toHaveLength(1);
  await cdp.detach();
});

test('eraser circle follows its real size, zoom and temporary barrel mode without becoming ink', async ({ page, context }) => {
  await start(page); const cdp = await context.newCDPSession(page);
  const circle = page.locator('.eraser-cursor');
  await page.getByRole('button', { name: '지우개', exact: true }).tap();
  await page.getByRole('button', { name: '버튼을 누르면 에어 커맨드가 열리나요?', exact: true }).tap();
  await expect(page.locator('#pen-button-guide')).toContainText('펜 버튼으로 에어 커맨드 열기');
  await page.getByRole('slider', { name: '지우개 크기' }).fill('60');
  await expect(circle).toBeVisible();
  const checkSize = async () => {
    const paper = (await page.locator('#paper-live').boundingBox())!, r = (await circle.boundingBox())!;
    expect(r.width).toBeCloseTo(60 * paper.width / 794, 0); expect(r.height).toBeCloseTo(r.width, 1);
  };
  await checkSize();
  await page.getByRole('button', { name: '펜 지우개', exact: true }).tap();
  await pen(page, cdp, 'mouseMoved', 220, 210, 0, 0);
  await expect(circle).toBeVisible(); await checkSize();
  const center = (await circle.boundingBox())!, paper = (await page.locator('#paper-live').boundingBox())!;
  expect(center.x + center.width / 2).toBeCloseTo(paper.x + 220 * paper.width / 794, 0);
  expect(center.y + center.height / 2).toBeCloseTo(paper.y + 210 * paper.height / 1123, 0);
  // A visible cursor must never be painted onto either saved or live ink.
  const alpha = await page.locator('#paper-live,#paper-ink').evaluateAll(canvases => canvases.map(canvas => {
    const c = canvas as HTMLCanvasElement, data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0; for (let i = 3; i < data.length; i += 4) sum += data[i]; return sum;
  }));
  expect(alpha).toEqual([0, 0]);
  await page.getByRole('button', { name: '축소', exact: true }).click();
  await pen(page, cdp, 'mouseMoved', 240, 210, 0, 0); await expect(circle).toBeVisible(); await checkSize();
  await page.screenshot({ path: '../MyNotes-eraser-circle.png' });
  await page.getByRole('button', { name: '볼펜', exact: true }).click(); await expect(circle).toBeHidden();
  await pen(page, cdp, 'mouseMoved', 240, 210, 2, 0, 'right'); await expect(circle).toBeVisible(); await checkSize();
  await pen(page, cdp, 'mouseMoved', 245, 210, 0, 0); await expect(circle).toBeHidden();
  await page.getByRole('button', { name: '지우개', exact: true }).click();
  await page.getByRole('button', { name: '스트로크 지우개', exact: true }).click();
  const rect = (await page.locator('#paper-live').boundingBox())!;
  await page.touchscreen.tap(rect.x + 180 * rect.width / 794, rect.y + 190 * rect.height / 1123);
  await expect(circle).toBeHidden();
  await cdp.detach();
});

test('pen check distinguishes pen input from a real barrel signal without changing the note', async ({ page, context }) => {
  await start(page); await page.getByRole('button', { name: '지우개', exact: true }).tap();
  await page.getByRole('button', { name: 'S펜 버튼 입력 확인', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'S펜 버튼 입력 확인', exact: true }), pad = dialog.locator('.pen-check-pad');
  await expect(dialog).toBeVisible(); const r = (await pad.boundingBox())!, cdp = await context.newCDPSession(page);
  const send = (type: 'mousePressed' | 'mouseReleased', button: 'left' | 'right', buttons: number, force: number) => cdp.send('Input.dispatchMouseEvent', { type, pointerType: 'pen', button, buttons, force, x: r.x + 50, y: r.y + 70 });
  await send('mousePressed', 'left', 1, .5); await send('mouseReleased', 'left', 0, 0);
  await dialog.getByRole('button', { name: '버튼을 누르고 테스트했어요', exact: true }).tap();
  await expect(dialog.locator('[role=status]')).toContainText('펜 입력은 오지만 버튼 신호는 아직 확인되지');
  await send('mousePressed', 'right', 2, .5); await send('mouseReleased', 'right', 0, 0);
  await expect(dialog.locator('[role=status]')).toContainText('버튼 신호를 받았어요');
  expect(await saved(page)).toHaveLength(0);
  await dialog.getByRole('button', { name: '닫기', exact: true }).last().tap();
  await expect(dialog).toHaveCount(0); await expect(page.locator('#paper-live')).toBeVisible(); await cdp.detach();
});
