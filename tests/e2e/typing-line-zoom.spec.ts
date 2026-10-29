import { test, expect, emulateStandalone, type Page } from './standalone-test';
import { selectPen } from './helpers';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function create(page: Page) {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('타이핑과 직선'); await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.locator('.app-slide-layer')).toHaveCount(0);
}
async function items(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise<any[]>(resolve => { const r = db.transaction('pages').objectStore('pages').getAll(); r.onsuccess = () => resolve(r.result.flatMap(p => p.items.filter((i: any) => !i.id.startsWith('welcome-')))); }); }
    finally { db.close(); }
  });
}

test('typed text keeps its own color without changing the saved pen', async ({ page }) => {
  await create(page);
  const penColor = await page.locator('.pen-tool').evaluate(button => (button as HTMLElement).style.getPropertyValue('--pen-color'));
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: '기본 색상 3', exact: true }).click();
  await page.getByRole('textbox', { name: '페이지에 글 입력' }).fill('별도 글자 색');
  await page.getByRole('button', { name: '입력 완료', exact: true }).click();
  await expect.poll(async () => (await items(page)).find(item => item.kind === 'text')?.color).toBe('#cf7d85');
  await page.getByRole('button', { name: '펜', exact: true }).click();
  expect(await page.locator('.pen-tool').evaluate(button => (button as HTMLElement).style.getPropertyValue('--pen-color'))).toBe(penColor);
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '타이핑과 직선 열기', exact: true }).click();
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await expect(page.getByRole('button', { name: '기본 색상 3', exact: true })).toHaveClass(/active/);
});

test('type directly on paper, format, move, resize, re-edit, undo and reopen', async ({ page }) => {
  await create(page); await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('combobox', { name: '입력 방식', exact: true }).selectOption('box');
  const canvas = page.locator('#paper-live'), rect = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: 110, y: 170 } });
  await expect(page.locator('dialog')).toHaveCount(0);
  const input = page.getByRole('textbox', { name: '페이지에 글 입력' }); await expect(input).toBeFocused();
  const ime = await page.context().newCDPSession(page);
  await ime.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await expect(input).toHaveValue('한'); await ime.send('Input.insertText', { text: '한글 입력' });
  await expect(input).toHaveValue('한글 입력'); await ime.detach();
  await input.fill('삼성노트처럼 종이에 바로 입력해요.\n한글과 English text를 함께 작성합니다.');
  await page.getByRole('spinbutton', { name: '글자 크기' }).fill('28');
  await page.getByRole('button', { name: '굵게', exact: true }).click();
  await page.getByRole('button', { name: '기울임', exact: true }).click();
  await page.getByRole('combobox', { name: '글자 정렬' }).selectOption('center');
  const move = (await page.getByRole('button', { name: '글상자 이동' }).boundingBox())!;
  await page.mouse.move(move.x + 10, move.y + 10); await page.mouse.down(); await page.mouse.move(move.x + 50, move.y + 45); await page.mouse.up();
  const resize = (await page.getByRole('button', { name: '글상자 너비 조절' }).boundingBox())!;
  await page.mouse.move(resize.x + 10, resize.y + 10); await page.mouse.down(); await page.mouse.move(resize.x - 160, resize.y + 10); await page.mouse.up();
  await page.screenshot({ path: '../MyNotes-inline-typing-active.png' });
  await page.getByRole('button', { name: '입력 완료', exact: true }).click();
  await expect.poll(async () => (await items(page)).length).toBe(1);
  const first = (await items(page))[0]; expect(first).toMatchObject({ kind: 'text', bold: true, italic: true, align: 'center', size: 28, wrap: true });
  expect(first.w).toBeLessThan(500); expect(first.x).toBeGreaterThan(110 / (rect.width / 794));
  await canvas.click({ position: { x: (first.x + 20) * rect.width / 794, y: (first.y + 15) * rect.width / 794 } });
  await expect(input).toHaveValue(first.text); await input.press('End'); await input.press('Enter'); await input.pressSequentially('edited');
  // Saving/navigating without a separate confirmation must keep the draft.
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.getByRole('button', { name: '타이핑과 직선 열기', exact: true }).click();
  await expect(canvas).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  await expect.poll(async () => (await items(page))[0]?.text).toContain('edited');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('combobox', { name: '입력 방식', exact: true }).selectOption('box');
  const current = (await items(page))[0], r = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: (current.x + 10) * r.width / 794, y: (current.y + 10) * r.width / 794 } });
  await input.fill('수정 취소'); await page.getByRole('button', { name: '입력 취소', exact: true }).click();
  await expect.poll(async () => (await items(page))[0]?.text).toBe(current.text);
  await canvas.click({ position: { x: (current.x + 10) * r.width / 794, y: (current.y + 10) * r.width / 794 } });
  await page.getByRole('button', { name: '글상자 삭제', exact: true }).click();
  await expect.poll(async () => (await items(page)).length).toBe(0);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect.poll(async () => (await items(page))[0]?.text).toBe(current.text);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'PDF 내보내기' }).click();
  const pdf = await PDFDocument.load(await readFile((await (await download).path())!));
  const images = pdf.context.enumerateIndirectObjects().flatMap(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image' ? [object] : []);
  expect(images.some(image => Number(image.dict.get(PDFName.of('Width'))?.toString()) >= current.w * 3.9)).toBe(true);
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '설정 및 백업', exact: true }).click();
  const backup = page.waitForEvent('download'); await page.getByRole('button', { name: '전체 백업', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await backup).path())!, 'utf8'));
  expect(saved.pages.flatMap((p: any) => p.items).find((i: any) => i.id === current.id)).toMatchObject({ text: current.text, bold: true, italic: true, wrap: true, align: 'center' });
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.getByRole('button', { name: '타이핑과 직선 열기', exact: true }).click();
  await page.screenshot({ path: '../MyNotes-inline-typing.png' });
});

test('document typing fills the page margins and continues on new pages without moving handwriting', async ({ page }) => {
  await create(page);
  const canvas = page.locator('#paper-live'), r = (await canvas.boundingBox())!;
  await page.mouse.move(r.x + 100, r.y + 180); await page.mouse.down(); await page.mouse.move(r.x + 380, r.y + 180, { steps: 20 }); await page.mouse.up();
  await expect.poll(async () => (await items(page)).filter(i => i.kind === 'stroke').length).toBe(1);
  const handwriting = (await items(page)).find(i => i.kind === 'stroke');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  const input = page.getByRole('textbox', { name: '페이지에 글 입력' });
  await expect(input).toBeFocused(); await expect(page.getByRole('combobox', { name: '입력 방식', exact: true })).toHaveValue('document');
  await expect(page.locator('.document-text-box')).toBeVisible();
  await expect(page.getByRole('button', { name: '글상자 이동' })).toHaveCount(0);
  const frame = (await input.boundingBox())!;
  expect(frame.x - r.x).toBeCloseTo(48 * r.width / 794, 0);
  expect(frame.width).toBeCloseTo((794 - 96) * r.width / 794, 0);
  const content = Array.from({ length: 65 }, (_, i) => `${i + 1}번째 줄 · 필기 위치와 관계없이 이어서 입력합니다.`).join('\n');
  await input.fill(content);
  await expect(page.locator('.page-position')).toHaveText('3 / 3'); await expect(input).toBeFocused();
  await input.press('End'); await input.press('Enter'); await input.pressSequentially('continued');
  await expect(input).toHaveValue(/continued$/);
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await expect(page.locator('#library-title')).toContainText('나의 서재');
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    try {
      const read = <T>(table: string) => new Promise<T[]>(resolve => { const r = db.transaction(table).objectStore(table).getAll(); r.onsuccess = () => resolve(r.result); });
      const note = (await read<any>('notes')).find(n => n.title === '타이핑과 직선'); const pages = await read<any>('pages');
      return note.pageIds.map((id: string) => pages.find(p => p.id === id));
    } finally { db.close(); }
  });
  expect(saved).toHaveLength(3);
  expect(saved.map((p: any) => p.items.find((i: any) => i.textMode === 'document')?.text ?? '').join('')).toBe(content + '\ncontinued');
  expect(saved[0].items.find((i: any) => i.kind === 'stroke')).toEqual(handwriting);
  expect(saved.flatMap((p: any) => p.items).filter((i: any) => i.kind === 'stroke')).toHaveLength(1);
  await page.getByRole('button', { name: '타이핑과 직선 열기', exact: true }).click();
  await expect(canvas).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.locator('.page-position')).toHaveText('3 / 3');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await expect(input).toHaveValue(saved[2].items.find((i: any) => i.textMode === 'document').text);
  await page.screenshot({ path: '../MyNotes-document-typing.png' });
});

test('holding a pen straightens the live stroke before release and lets the endpoint move', async ({ page, context }) => {
  await page.clock.install(); await create(page);
  const r = (await page.locator('#paper-live').boundingBox())!, cdp = await context.newCDPSession(page);
  for (const [tool, y] of [['볼펜', 240], ['연필', 330]] as const) {
    await selectPen(page, tool);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, force: .5, x: r.x + 90, y: r.y + y, clickCount: 1 });
    for (let i = 1; i <= 24; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', buttons: 1, force: .5, x: r.x + 90 + i * 7, y: r.y + y + Math.sin(i / 3) * 5 });
    await page.clock.runFor(650); await expect(page.locator('#toast')).toContainText('직선으로 정리');
    expect((await items(page)).length).toBe(tool === '볼펜' ? 0 : 1);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', buttons: 1, force: .5, x: r.x + 320, y: r.y + y + 30 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, force: 0, x: r.x + 320, y: r.y + y + 30, clickCount: 1 });
    await page.clock.runFor(30);
  }
  await expect.poll(async () => (await items(page)).length).toBe(2);
  for (const stroke of await items(page)) {
    const a = stroke.points[0], b = stroke.points.at(-1);
    expect(stroke.points.every((p: any) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) < 1e-5)).toBe(true);
  }
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await page.clock.runFor(30);
  await expect.poll(async () => (await items(page)).length).toBe(1);
  // Cancelling a held stroke never leaks its timer into the next page/tool.
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, force: .5, x: r.x + 90, y: r.y + 400, clickCount: 1 });
  await page.getByRole('button', { name: '이동', exact: true }).click(); await page.clock.runFor(700);
  await expect.poll(async () => (await items(page)).length).toBe(1);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, x: r.x + 90, y: r.y + 400, clickCount: 1 });
  await cdp.detach();
});

test('mobile home stays at device scale while the paper keeps its own pinch zoom', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, isMobile: true, hasTouch: true });
  await emulateStandalone(context);
  const page = await context.newPage(); await page.goto('./'); await expect(page.locator('h1')).toBeVisible();
  // Exercise the event guard with viewport zoom allowed, like a browser that
  // overrides the maximum-scale restriction. Single-finger scrolling survives.
  const cancelled = await page.evaluate(() => {
    document.querySelector('meta[name=viewport]')!.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes');
    const target = document.querySelector('h1')!;
    const a = new Touch({ identifier: 1, target, clientX: 300, clientY: 350 });
    const b = new Touch({ identifier: 2, target, clientX: 500, clientY: 350 });
    const single = !target.dispatchEvent(new TouchEvent('touchstart', { touches: [a], bubbles: true, cancelable: true }));
    const multi = !target.dispatchEvent(new TouchEvent('touchmove', { touches: [a, b], bubbles: true, cancelable: true }));
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
    return { single, multi };
  });
  expect(cancelled).toEqual({ single: false, multi: true });
  const cdp = await context.newCDPSession(page), start = await page.evaluate(() => visualViewport!.scale);
  await cdp.send('Input.synthesizePinchGesture', { x: 400, y: 350, scaleFactor: 2, gestureSourceType: 'touch' });
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(start);
  const prevented = await page.evaluate(() => !document.querySelector('h1')!.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true })));
  expect(prevented).toBe(true);
  await create(page);
  const v = (await page.locator('.paper-viewport').boundingBox())!, y = v.y + 210, x = v.x + v.width / 2;
  const points = (d: number) => [{ id: 1, x: x - d, y }, { id: 2, x: x + d, y }];
  const zoom = await page.locator('#zoom-value').innerText();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(50) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(100) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#zoom-value')).not.toHaveText(zoom); expect(await page.evaluate(() => visualViewport!.scale)).toBe(start);
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  const r = (await page.locator('#paper-live').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 3, x: Math.max(v.x + 100, r.x + 90), y: Math.max(v.y + 150, r.y + 150) }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const input = page.getByRole('textbox', { name: '페이지에 글 입력' }); await expect(input).toBeFocused();
  await input.fill('손가락으로 눌러도 바로 타이핑해요.');
  await page.setViewportSize({ width: 390, height: 650 });
  const text = Array.from({ length: 14 }, (_, i) => `입력한 줄 ${i + 1}`).join('\n');
  const beforeScroll = await page.locator('.paper-viewport').evaluate(el => el.scrollTop);
  await input.fill(text);
  await expect.poll(() => page.locator('.paper-viewport').evaluate(el => el.scrollTop)).toBeGreaterThan(beforeScroll);
  const toolbar = (await page.getByRole('toolbar', { name: '글자 서식', exact: true }).boundingBox())!;
  expect(toolbar.x).toBeGreaterThanOrEqual(0); expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '입력 완료', exact: true }).tap();
  await expect.poll(async () => (await items(page))[0]?.text).toBe(text);
  await context.close();
});
