import { test, expect } from '@playwright/test';

test('pencil makes a dense dark graphite curve with visible paper grain', async ({ page, context }) => {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('연필 질감'); await page.locator('.paper-options label').filter({ hasText: '무지' }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click(); await expect(page.locator('#app .page-loading')).toBeHidden();
  await page.getByRole('button', { name: '연필', exact: true }).click();
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill('6'); await page.locator('#ink-color').fill('#252525');
  const r = (await page.locator('#paper-live').boundingBox())!, scale = r.width / 794;
  const cdp = await context.newCDPSession(page);
  const curves = [[140, 220, 170, 165, 210, 155, 220, 160], [220, 160, 205, 185, 175, 245, 190, 250],
    [190, 250, 210, 215, 260, 175, 300, 175], [300, 175, 260, 220, 250, 285, 263, 290],
    [263, 290, 290, 247, 335, 210, 375, 215], [375, 215, 340, 248, 345, 306, 357, 320],
    [357, 320, 383, 278, 430, 247, 465, 250], [465, 250, 426, 290, 430, 345, 448, 360]];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, force: .65, x: r.x + 140 * scale, y: r.y + 220 * scale });
  for (const [x0, y0, x1, y1, x2, y2, x3, y3] of curves) for (let i = 1; i <= 28; i++) {
    const t = i / 28, u = 1 - t, x = u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3, y = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', button: 'left', buttons: 1, force: .65, x: r.x + x * scale, y: r.y + y * scale });
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, force: 0, x: r.x + 448 * scale, y: r.y + 360 * scale });
  const coverage = await page.locator('#paper-ink').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0, dark = 0, paper = 0, alpha = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) { ink++; alpha += data[i]; if (data[i] > 150) dark++; if (data[i] < 100) paper++; }
    return { dark: dark / ink, paper: paper / ink, average: alpha / ink };
  });
  await page.screenshot({ path: '../MyNotes-pencil-reference.png' });
  expect(coverage.dark).toBeGreaterThan(.12); expect(coverage.paper).toBeGreaterThan(.12); expect(coverage.average).toBeGreaterThan(90);
  await cdp.detach();
});

test('ballpoint stays constant, fountain responds to pressure and pencil has stable graphite texture', async ({ page, context }) => {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('세 가지 필기 도구'); await page.locator('.paper-options label').filter({ hasText: '무지' }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click(); await expect(page.locator('#app .page-loading')).toBeHidden();
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill('12');
  const cdp = await context.newCDPSession(page);
  const stroke = async (y: number, force: number) => {
    const r = (await page.locator('#paper-live').boundingBox())!, scale = r.width / 794;
    const send = (type: 'mousePressed' | 'mouseReleased' | 'mouseMoved', x: number, pressure: number, buttons: number) => cdp.send('Input.dispatchMouseEvent', { type, pointerType: 'pen', button: 'left', buttons, force: pressure, x: r.x + x * scale, y: r.y + y * scale, clickCount: 1 });
    await send('mousePressed', 100, force, 1);
    for (let x = 104; x <= 320; x += 4) await send('mouseMoved', x, force, 1);
    await send('mouseReleased', 320, 0, 0);
  };
  await stroke(100, .1); await stroke(150, .9);
  await page.getByRole('button', { name: '만년필', exact: true }).click(); await stroke(230, .1); await stroke(280, .9);
  await page.getByRole('button', { name: '연필', exact: true }).click(); await stroke(360, .1); await stroke(410, .9);
  const measured = await page.locator('#paper-ink').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!, scale = canvas.width / 794;
    return [100, 150, 230, 280, 360, 410].map(y => {
      const data = ctx.getImageData(Math.round(160 * scale), Math.floor((y - 14) * scale), Math.ceil(100 * scale), Math.ceil(28 * scale));
      const alphas: number[] = [];
      for (let i = 3; i < data.data.length; i += 4) alphas.push(data.data[i]);
      return { area: alphas.filter(a => a > 80).length, mass: alphas.reduce((a, b) => a + b, 0), shades: new Set(alphas.filter(a => a > 0)).size, max: Math.max(...alphas) };
    });
  });
  await page.screenshot({ path: '../MyNotes-brushes.png' });
  // Integrated alpha avoids a one-pixel threshold difference from subpixel Y.
  expect(measured[1].mass / measured[0].mass).toBeCloseTo(1, 1);
  expect(measured[3].area).toBeGreaterThan(measured[2].area * 2.5);
  expect(measured[5].mass).toBeGreaterThan(measured[4].mass * 1.5);
  expect(measured[5].max).toBeLessThan(255); expect(measured[5].shades).toBeGreaterThan(12);
  const readStrokes = () => page.evaluate(async () => {
    const noteId = document.querySelector<HTMLElement>('.note-tab.active [data-action=tab]')!.dataset.id;
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    const pages = await new Promise<any[]>(resolve => { const r = db.transaction('pages').objectStore('pages').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return pages.find(p => p.noteId === noteId)?.items || [];
  });
  await expect.poll(async () => (await readStrokes()).length).toBe(6);
  const saved = await readStrokes();
  expect(saved.map((s: any) => s.tool)).toEqual(['pen', 'pen', 'fountain', 'fountain', 'pencil', 'pencil']);
  expect(saved.slice(0, 2).every((s: any) => s.pressure === false)).toBe(true);
  expect(saved.slice(2).every((s: any) => s.pressure === true && s.brushVersion === 2)).toBe(true);
  const fingerprint = () => page.locator('#paper-ink').evaluate((canvas: HTMLCanvasElement) => {
    const scale = canvas.width / 794;
    const pixels = canvas.getContext('2d')!.getImageData(Math.floor(90 * scale), Math.floor(345 * scale), Math.ceil(240 * scale), Math.ceil(80 * scale)).data;
    const alpha: number[] = []; for (let i = 3; i < pixels.length; i += 4) alpha.push(pixels[i]);
    return alpha;
  });
  const before = await fingerprint();
  const compareGraphite = async () => {
    const after = await fingerprint(); expect(after.length).toBe(before.length);
    const error = after.reduce((sum, value, i) => sum + Math.abs(value - before[i]), 0) / after.length;
    expect(error).toBeLessThan(1);
  };
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click(); await expect(page.locator('#library-title')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: '세 가지 필기 도구 열기', exact: true }).click();
  await expect(page.locator('#app .page-loading')).toBeHidden();
  await compareGraphite();
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '설정 및 백업', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '전체 백업', exact: true }).click();
  const backup = await (await download).path();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '백업 파일 복원', exact: true }).click(); await (await chooser).setFiles(backup!);
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '세 가지 필기 도구 (복원) 열기', exact: true }).click(); await expect(page.locator('#app .page-loading')).toBeHidden();
  await compareGraphite();
  const withoutId = (items: any[]) => items.map(({ id, ...item }) => item);
  expect(withoutId(await readStrokes())).toEqual(withoutId(saved));
  await cdp.detach();
});
