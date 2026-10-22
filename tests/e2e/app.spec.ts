import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function records(page: Page, table: string) {
  return page.evaluate(async table => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('mynotes-v1'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    try { return await new Promise<any[]>((resolve, reject) => { const req = db.transaction(table).objectStore(table).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
    finally { db.close(); }
  }, table);
}
async function pen(page: Page, x = 120, y = 220) {
  const canvas = page.locator('#paper-live'), r = await canvas.boundingBox(); if (!r) throw new Error('canvas missing');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, force: .2, x: r.x + x, y: r.y + y, clickCount: 1 });
  for (let n = 1; n <= 30; n++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', button: 'left', buttons: 1, force: .2 + n / 45, x: r.x + x + n * 4, y: r.y + y + Math.sin(n / 5) * 15 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, force: 0, x: r.x + x + 120, y: r.y + y, clickCount: 1 });
  await cdp.detach();
}
test('notebook creation, pressure ink, undo, reload, page management, trash recovery', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('./'); await expect(page.locator('h1')).toContainText('나의 서재');
  await page.screenshot({ path: '../MyNotes-library.png', fullPage: true });
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('S펜 학습 노트');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible();
  await expect(page.locator('.page-loading')).toBeHidden();
  await pen(page);
  await expect.poll(async () => (await records(page, 'pages')).find(p => p.items.some((i: any) => i.kind === 'stroke' && i.id !== 'welcome-line'))?.items.length).toBe(1);
  const ink = (await records(page, 'pages')).find(p => p.items.length === 1).items[0];
  const writtenPageId = (await records(page, 'pages')).find(p => p.items.length === 1).id;
  expect(ink.points.length).toBeGreaterThan(20); expect(ink.points[0].p).toBeLessThan(ink.points.at(-1).p);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await expect.poll(async () => (await records(page, 'pages')).find(p => p.id === writtenPageId)?.items.length).toBe(0);
  await page.getByRole('button', { name: '다시 실행 (Ctrl+Shift+Z)', exact: true }).click();
  await expect.poll(async () => (await records(page, 'pages')).find(p => p.id === writtenPageId)?.items.length).toBe(1);
  await page.locator('#save-status').click(); await expect(page.locator('#save-status')).toContainText('모든 변경사항');
  await page.reload(); await expect(page.locator('h1')).toBeVisible();
  await page.getByRole('button', { name: 'S펜 학습 노트 열기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  expect((await records(page, 'pages')).some(p => p.items.some((i: any) => i.id === ink.id))).toBe(true);
  await page.getByRole('button', { name: '페이지 추가', exact: true }).last().click();
  await expect(page.locator('.page-position')).toHaveText('2 / 2');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  const r = await page.locator('#paper-live').boundingBox();
  await page.mouse.click(r!.x + 120, r!.y + 180); await page.locator('textarea').fill('오늘 배운 내용을 정리해요');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await expect.poll(async () => (await records(page, 'pages')).some(p => p.items.some((i: any) => i.text === '오늘 배운 내용을 정리해요'))).toBe(true);
  await page.screenshot({ path: '../MyNotes-editor.png' });
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  const card = page.locator('.note-card').filter({ hasText: 'S펜 학습 노트' });
  await card.getByRole('button', { name: 'S펜 학습 노트 메뉴' }).click(); await page.getByRole('menuitem', { name: '휴지통으로 이동' }).click();
  await page.locator('dialog').getByRole('button', { name: '이동', exact: true }).click();
  await page.locator('.library-sidebar').getByRole('button', { name: /휴지통/ }).click();
  await page.getByRole('button', { name: 'S펜 학습 노트 메뉴' }).click(); await page.getByRole('menuitem', { name: '노트 복구' }).click();
  await expect.poll(async () => (await records(page, 'notes')).find(n => n.title === 'S펜 학습 노트').deleted).toBeNull();
  expect(errors).toEqual([]);
});

test('installable PWA, offline PDF annotation, export and backup restore', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('./'); await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  expect(manifest.display).toBe('standalone'); expect(manifest.scope).toBe('/mynotes/');
  expect(manifest.icons.some((i: any) => i.sizes === '512x512')).toBe(true);
  await context.setOffline(true); await page.reload(); await expect(page.locator('h1')).toContainText('나의 서재');
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText('Offline PDF study test', { x: 50, y: 700, font, size: 24, color: rgb(.2, .3, .5) });
  doc.addPage([600, 800]); const bytes = await doc.save();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'PDF 가져오기', exact: true }).click();
  await (await chooser).setFiles({ name: 'Study.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  await pen(page); const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF 내보내기', exact: true }).click();
  const exported = await downloadEvent, path = await exported.path();
  const result = await PDFDocument.load(await readFile(path!)); expect(result.getPageCount()).toBe(2); expect(result.getPage(0).getWidth()).toBe(600);
  await page.getByRole('button', { name: '노트 설정', exact: true }).click();
  const backupEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '전체 백업', exact: true }).click();
  const backupDownload = await backupEvent, backupPath = await backupDownload.path();
  const backupData = JSON.parse(await readFile(backupPath!, 'utf8')); expect(backupData.assets).toHaveLength(1);
  const restoreChooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '백업 파일 복원', exact: true }).click();
  await (await restoreChooser).setFiles(backupPath!);
  await expect(page.locator('h1')).toContainText('나의 서재');
  expect((await records(page, 'notes')).filter(n => n.title.includes('(복원)'))).toHaveLength(2);
  expect((await records(page, 'assets')).length).toBe(2);
  expect(errors).toEqual([]);
});

test('mobile library and folder management', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('./');
  await expect(page.locator('h1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.getByRole('button', { name: '새 폴더 만들기', exact: true }).click();
  await page.locator('[name=name]').fill('수학 공부'); await page.getByRole('button', { name: '폴더 만들기', exact: true }).click();
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.locator('.folder-nav').getByRole('button', { name: /수학 공부/ }).first().click();
  await expect(page.locator('h1')).toContainText('수학 공부');
  await page.screenshot({ path: '../MyNotes-mobile.png', fullPage: true });
});

test('shape, lasso move/resize/copy/delete, partial eraser and zoom coordinates', async ({ page }) => {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('도구 검증'); await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  const testNote = (await records(page, 'notes')).find(n => n.title === '도구 검증');
  const current = async () => (await records(page, 'pages')).find(p => p.noteId === testNote.id);
  const rect = await page.locator('#paper-live').boundingBox();
  const draw = async (x1: number, y1: number, x2: number, y2: number) => { await page.mouse.move(rect!.x + x1, rect!.y + y1); await page.mouse.down(); await page.mouse.move(rect!.x + x2, rect!.y + y2, { steps: 15 }); await page.mouse.up(); };
  await page.getByRole('button', { name: '도형', exact: true }).click(); await draw(180, 170, 340, 280);
  await expect.poll(async () => (await current())?.items.length).toBe(1);
  expect((await current()).items[0].kind).toBe('shape');
  await page.getByRole('button', { name: '올가미', exact: true }).click();
  await page.mouse.move(rect!.x + 150, rect!.y + 140); await page.mouse.down();
  for (const [x, y] of [[370, 140], [370, 310], [150, 310], [150, 140]]) await page.mouse.move(rect!.x + x, rect!.y + y, { steps: 6 });
  await page.mouse.up(); await expect(page.locator('.selection-toolbar')).toBeVisible();
  await page.getByRole('button', { name: '선택 확대', exact: true }).click();
  const enlarged = (await current()).items[0]; expect(enlarged.w).toBeGreaterThan(100);
  await page.getByRole('button', { name: '선택 복사', exact: true }).click(); await page.keyboard.press('Control+v');
  await expect.poll(async () => (await current()).items.length).toBe(2);
  await page.getByRole('button', { name: '선택 삭제', exact: true }).click();
  await expect.poll(async () => (await current()).items.length).toBe(1);
  await page.getByRole('button', { name: '볼펜', exact: true }).click(); await pen(page, 120, 380);
  await page.getByRole('button', { name: '확대', exact: true }).click();
  const zoomRect = await page.locator('#paper-live').boundingBox();
  await page.getByRole('button', { name: '도형', exact: true }).click();
  await page.mouse.move(zoomRect!.x + 100, zoomRect!.y + 100); await page.mouse.down(); await page.mouse.move(zoomRect!.x + 180, zoomRect!.y + 180, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await current()).items.length).toBe(3);
  const last = (await current()).items.at(-1);
  expect(last.x).toBeCloseTo(100 * (await current()).width / zoomRect!.width, 0);
  await page.getByRole('button', { name: '지우개', exact: true }).click(); await page.locator('#eraser-mode').selectOption('partial');
  await page.locator('#eraser-size').fill('25');
  const before = (await current()).items.filter((i: any) => i.kind === 'stroke')[0];
  const r = await page.locator('#paper-live').boundingBox(), scale = r!.width / (await current()).width;
  const middle = before.points[Math.floor(before.points.length / 2)];
  await page.mouse.click(r!.x + middle.x * scale, r!.y + middle.y * scale);
  await expect.poll(async () => (await current()).items.filter((i: any) => i.kind === 'stroke').length).toBe(2);
});
