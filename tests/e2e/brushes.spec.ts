import { test, expect } from '@playwright/test';

test('pencil PDF preserves the paper grain and its position', async ({ page, context }) => {
  await page.addInitScript(() => { Math.random = () => .12345; });
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('흑연 PDF'); await page.locator('.paper-options label').filter({ hasText: '무지' }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click(); await expect(page.locator('.page-loading')).toBeHidden();
  await page.getByRole('button', { name: '연필', exact: true }).click();
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).fill('8'); await page.locator('#ink-color').fill('#252525');
  const r = (await page.locator('#paper-live').boundingBox())!, scale = r.width / 794, cdp = await context.newCDPSession(page);
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number) => cdp.send('Input.dispatchMouseEvent', { type, pointerType: 'pen', button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, force: type === 'mouseReleased' ? 0 : .65, x: r.x + x * scale, y: r.y + 200 * scale });
  await send('mousePressed', 100); for (let x = 104; x <= 360; x += 4) await send('mouseMoved', x); await send('mouseReleased', 360);
  const pixels = () => page.evaluate(() => {
    const background = document.querySelector<HTMLCanvasElement>('#paper-background')!, ink = document.querySelector<HTMLCanvasElement>('#paper-ink')!;
    const canvas = document.createElement('canvas'); canvas.width = background.width; canvas.height = background.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(background, 0, 0); ctx.drawImage(ink, 0, 0, canvas.width, canvas.height);
    const scale = canvas.width / 794, data = ctx.getImageData(Math.round(140 * scale), Math.round(198 * scale), Math.round(180 * scale), Math.round(4 * scale)).data;
    return Array.from({ length: data.length / 4 }, (_, i) => data[i * 4]);
  });
  const before = await pixels(), downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF 내보내기', exact: true }).click(); const path = await (await downloadEvent).path();
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'PDF 가져오기', exact: true }).click(); await (await chooser).setFiles(path!);
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden(); const after = await pixels();
  const error = after.reduce((sum, value, i) => sum + Math.abs(value - before[i]), 0) / after.length;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const beforeMean = mean(before), afterMean = mean(after);
  const correlation = after.reduce((sum, value, i) => sum + (value - afterMean) * (before[i] - beforeMean), 0) / Math.sqrt(after.reduce((sum, value) => sum + (value - afterMean) ** 2, 0) * before.reduce((sum, value) => sum + (value - beforeMean) ** 2, 0));
  console.log('graphite PDF pixels', JSON.stringify({ error, beforeMean, afterMean, correlation }));
  // PDF.js rasterizes the vector tile at the viewing scale; Canvas samples a
  // supersampled tile. Allow their edge coverage to differ, while requiring
  // comparable darkness and correlated fine texture. The soft material has
  // much less contrast, so differences in subpixel sampling affect correlation.
  expect(after.length).toBe(before.length); expect(error).toBeLessThan(15);
  expect(Math.abs(afterMean - beforeMean)).toBeLessThan(8); expect(correlation).toBeGreaterThan(.5);
  expect(Math.max(...after) - Math.min(...after)).toBeGreaterThan(10);
  expect(Math.max(...after) - Math.min(...after)).toBeLessThan(100);
  await cdp.detach();
});

test('pencil keeps a continuous graphite curve with fine paper texture', async ({ page, context }) => {
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
  const samples: { x: number; y: number }[] = [];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, force: .65, x: r.x + 140 * scale, y: r.y + 220 * scale });
  for (const [x0, y0, x1, y1, x2, y2, x3, y3] of curves) for (let i = 1; i <= 28; i++) {
    const t = i / 28, u = 1 - t, x = u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3, y = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3;
    samples.push({ x, y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', button: 'left', buttons: 1, force: .65, x: r.x + x * scale, y: r.y + y * scale });
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const continuity = await page.locator('#paper-live').evaluate((canvas: HTMLCanvasElement, samples) => {
    const ctx = canvas.getContext('2d')!, scale = canvas.width / 794;
    return samples.slice(2, -2).map(p => {
      const pixels = ctx.getImageData(Math.round(p.x * scale) - 1, Math.round(p.y * scale) - 1, 3, 3).data;
      return Math.max(...Array.from({ length: 9 }, (_, i) => pixels[i * 4 + 3]));
    });
  }, samples);
  expect(Math.min(...continuity)).toBeGreaterThan(85);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, force: 0, x: r.x + 448 * scale, y: r.y + 360 * scale });
  const coverage = await page.locator('#paper-ink').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0, dark = 0, alpha = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) { ink++; alpha += data[i]; if (data[i] > 150) dark++; }
    return { dark: dark / ink, average: alpha / ink };
  });
  await page.screenshot({ path: '../MyNotes-pencil-reference.png' });
  expect(coverage.dark).toBeGreaterThan(.12); expect(coverage.average).toBeGreaterThan(110);
  await cdp.detach();
});

test('live ballpoint, marker, shape and thin pencil stay connected after lasso selection', async ({ page, context }) => {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('.paper-options label').filter({ hasText: '무지' }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#app .page-loading')).toBeHidden(); await expect(page.locator('.app-slide-layer')).toHaveCount(0);
  const cdp = await context.newCDPSession(page);
  const send = async (type: 'mousePressed' | 'mouseReleased' | 'mouseMoved', x: number, y: number) => {
    const r = (await page.locator('#paper-live').boundingBox())!, scale = r.width / 794;
    return cdp.send('Input.dispatchMouseEvent', { type, pointerType: 'pen', button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, force: type === 'mouseReleased' ? 0 : .65, x: r.x + x * scale, y: r.y + y * scale });
  };
  for (const [tool, y, minimum] of [['볼펜', 100, 240], ['형광펜', 180, 70], ['도형', 260, 240], ['연필', 340, 25]] as const) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    if (tool === '도형') {
      await page.getByRole('button', { name: '필기 옵션', exact: true }).click();
      await page.getByRole('combobox', { name: '도형 종류', exact: true }).selectOption('line');
      await page.getByRole('button', { name: '필기 옵션 닫기', exact: true }).click();
    }
    await send('mousePressed', 100, y);
    for (let x = 104; x <= 320; x += 4) await send('mouseMoved', x, y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const live = await page.locator('#paper-live').evaluate((canvas: HTMLCanvasElement, y) => {
      const ctx = canvas.getContext('2d')!, scale = canvas.width / 794;
      const data = ctx.getImageData(Math.ceil(110 * scale), Math.floor((y - 1) * scale), Math.floor(200 * scale), Math.ceil(2 * scale));
      return Array.from({ length: data.width }, (_, x) => Math.max(...Array.from({ length: data.height }, (_, y) => data.data[(y * data.width + x) * 4 + 3])));
    }, y);
    expect(Math.min(...live), `${tool} must stay connected before lifting the pen`).toBeGreaterThan(minimum);
    if (tool === '볼펜') await page.screenshot({ path: '../MyNotes-live-ballpoint.png' });
    await send('mouseReleased', 320, y);
    if (tool === '볼펜') {
      await page.getByRole('button', { name: '올가미', exact: true }).click();
      await send('mousePressed', 80, 80);
      for (const [x, y] of [[340, 80], [340, 120], [80, 120], [80, 80]]) await send('mouseMoved', x, y);
      await send('mouseReleased', 80, 80); await expect(page.locator('#selection-count')).toContainText('1개 선택');
    }
  }
  await cdp.detach();
});

test('ballpoint and pencil stay fixed while fountain responds to pressure and pencil darkness is adjustable', async ({ page, context }) => {
  await page.addInitScript(() => { Math.random = () => .12345; });
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
  await page.getByRole('button', { name: '연필', exact: true }).click(); await stroke(360, .1);
  const pressurePixels = () => page.locator('#paper-ink').evaluate((canvas: HTMLCanvasElement) => {
    const scale = canvas.width / 794;
    const data = canvas.getContext('2d')!.getImageData(Math.floor(90 * scale), Math.floor(345 * scale), Math.ceil(240 * scale), Math.ceil(30 * scale)).data;
    return Array.from({ length: data.length / 4 }, (_, i) => data[i * 4 + 3]);
  });
  const lightPressure = await pressurePixels();
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click(); await stroke(360, .9);
  const heavyPressure = await pressurePixels();
  // Same paper position and texture seed isolate pressure from paper relief.
  // Check actual width AND darkness, allowing only alpha quantization at
  // incremental chunk edges when browser frame timing differs between runs.
  expect(heavyPressure.length).toBe(lightPressure.length);
  const pressureError = heavyPressure.map((value, i) => Math.abs(value - lightPressure[i]));
  expect(Math.max(...pressureError)).toBeLessThanOrEqual(2);
  expect(pressureError.reduce((sum, value) => sum + value, 0) / pressureError.length).toBeLessThan(.05);
  await page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true }).click();
  await stroke(360, .1); await stroke(410, .9);
  await page.getByRole('combobox', { name: '연필 조절 항목', exact: true }).selectOption('darkness');
  await page.getByRole('slider', { name: '연필 진하기', exact: true }).fill('25'); await stroke(490, .9);
  await page.getByRole('slider', { name: '연필 진하기', exact: true }).fill('85'); await stroke(540, .1);
  await page.getByRole('button', { name: '연필 진하기 늘리기', exact: true }).click(); await expect(page.locator('#width-value')).toHaveText('90%');
  await page.getByRole('button', { name: '연필 진하기 줄이기', exact: true }).click(); await expect(page.locator('#width-value')).toHaveText('85%');
  const measured = await page.locator('#paper-ink').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!, scale = canvas.width / 794;
    return [100, 150, 230, 280, 360, 410, 490, 540].map(y => {
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
  expect(measured[7].mass).toBeGreaterThan(measured[6].mass * 2.8);
  expect(measured[5].max).toBeLessThan(255); expect(measured[5].shades).toBeGreaterThan(12);
  // Texture remains visible, with a bounded contrast inside the line and no
  // white flecks. Exclude edge antialiasing from this material measurement.
  const graphite = await page.locator('#paper-ink').evaluate((canvas: HTMLCanvasElement) => {
    const scale = canvas.width / 794, pixels = canvas.getContext('2d')!.getImageData(Math.round(160 * scale), Math.round(408 * scale), Math.round(100 * scale), Math.round(4 * scale)).data;
    const alpha = Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + 3]);
    const mean = alpha.reduce((sum, a) => sum + a, 0) / alpha.length;
    return { low: Math.min(...alpha), variation: Math.sqrt(alpha.reduce((sum, a) => sum + (a - mean) ** 2, 0) / alpha.length) };
  });
  // Connected deposits need more variation than the previous flat material,
  // while the continuous base still prevents white gaps in the stroke core.
  expect(graphite.low).toBeGreaterThan(90); expect(graphite.variation).toBeGreaterThan(10); expect(graphite.variation).toBeLessThan(32);
  const readStrokes = () => page.evaluate(async () => {
    const noteId = document.querySelector<HTMLElement>('.note-tab.active [data-action=tab]')!.dataset.id;
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    const pages = await new Promise<any[]>(resolve => { const r = db.transaction('pages').objectStore('pages').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return pages.find(p => p.noteId === noteId)?.items || [];
  });
  await expect.poll(async () => (await readStrokes()).length).toBe(8);
  const saved = await readStrokes();
  expect(saved.map((s: any) => s.tool)).toEqual(['pen', 'pen', 'fountain', 'fountain', 'pencil', 'pencil', 'pencil', 'pencil']);
  expect(saved.slice(0, 2).every((s: any) => s.pressure === false)).toBe(true);
  expect(saved.slice(2, 4).every((s: any) => s.pressure === true && s.brushVersion === 2)).toBe(true);
  expect(saved.slice(4).every((s: any) => s.pressure === false)).toBe(true);
  expect(saved.slice(4).map((s: any) => s.pencilDarkness)).toEqual([.7, .7, .25, .85]);
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
  await page.getByRole('button', { name: '연필', exact: true }).click();
  await page.getByRole('combobox', { name: '연필 조절 항목', exact: true }).selectOption('darkness');
  await expect(page.getByRole('slider', { name: '연필 진하기', exact: true })).toHaveValue('85');
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
