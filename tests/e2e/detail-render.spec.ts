import { test, expect } from './standalone-test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { setInkColor } from './helpers';

test.use({ deviceScaleFactor: 2.5, viewport: { width: 1280, height: 800 } });

test('zoomed PDF and ink use a sharp visible tile instead of enlarging the capped page canvas', async ({ page, context }) => {
  await page.goto('./');
  const pdf = await PDFDocument.create(), sheet = pdf.addPage([794, 1123]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  sheet.drawText('DETAIL AT HIGH ZOOM', { x: 105, y: 935, size: 36, font, color: rgb(0, 0, 0) });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'PDF 가져오기', exact: true }).click();
  await (await chooser).setFiles({ name: '선명도.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('#paper-live')).toBeVisible();
  await expect(page.locator('.page-loading')).toBeHidden();
  const detail = page.locator('.paper-surface .paper-detail');
  await expect(detail).toBeHidden();
  await page.locator('.paper-viewport').dispatchEvent('wheel', { deltaY: -700, ctrlKey: true });
  await expect(page.locator('#zoom-value')).toHaveText('400%');
  await expect(detail).toBeVisible();
  const sizes = await page.evaluate(() => {
    const base = document.querySelector<HTMLCanvasElement>('#paper-background')!;
    const tile = document.querySelector<HTMLCanvasElement>('.paper-surface .paper-detail')!;
    const data = tile.getContext('2d')!.getImageData(0, 0, tile.width, tile.height).data;
    const baseData = base.getContext('2d')!.getImageData(0, 0, base.width, base.height).data;
    const surface = tile.parentElement!, left = Number.parseFloat(tile.style.left), top = Number.parseFloat(tile.style.top);
    const width = Number.parseFloat(tile.style.width), height = Number.parseFloat(tile.style.height);
    let dark = 0, aligned = 0;
    for (let i = 0; i < data.length; i += 16) {
      if (data[i] >= 80 || data[i + 3] <= 200) continue;
      dark++;
      const pixel = i / 4, tx = pixel % tile.width, ty = Math.floor(pixel / tile.width);
      const bx = Math.round((left + tx * width / tile.width) * base.width / surface.clientWidth);
      const by = Math.round((top + ty * height / tile.height) * base.height / surface.clientHeight);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = bx + dx, y = by + dy;
        if (x < 0 || y < 0 || x >= base.width || y >= base.height) continue;
        if (baseData[(y * base.width + x) * 4] < 140) { aligned++; dy = 3; break; }
      }
    }
    return { dpr: devicePixelRatio, baseDensity: base.width / base.getBoundingClientRect().width,
      detailDensity: tile.width / tile.getBoundingClientRect().width, pixels: tile.width * tile.height, dark, aligned };
  });
  expect(sizes.baseDensity).toBeLessThan(.9);
  expect(sizes.detailDensity).toBeGreaterThan(sizes.baseDensity * 1.1);
  expect(sizes.detailDensity).toBeGreaterThan(2.4);
  expect(sizes.pixels).toBeLessThan(8100000);
  expect(sizes.dark).toBeGreaterThan(50);
  expect(sizes.aligned / sizes.dark).toBeGreaterThan(.7);
  const suspended = await page.evaluate(() => {
    document.querySelector('.paper-viewport')!.dispatchEvent(new WheelEvent('wheel',
      { deltaY: 150, ctrlKey: true, bubbles: true, cancelable: true }));
    const canvas = document.querySelector<HTMLCanvasElement>('.paper-surface .paper-detail')!;
    return { hidden: canvas.hidden, width: canvas.width };
  });
  expect(suspended).toEqual({ hidden: true, width: 0 });
  await expect(detail).toBeVisible();
  const viewport = (await page.locator('.paper-viewport').boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const touches = (distance: number) => [
    { id: 1, x: viewport.x + viewport.width / 2 - distance / 2, y: viewport.y + 220 },
    { id: 2, x: viewport.x + viewport.width / 2 + distance / 2, y: viewport.y + 220 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(160) });
  await expect(page.locator('.zoom-preview')).toHaveCount(1);
  await expect(detail).toBeHidden();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(220) });
  await expect(detail).toBeHidden();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.zoom-preview')).toHaveCount(0);
  await expect(detail).toBeVisible();
  await cdp.detach();
  await setInkColor(page, '#1260ec');
  const paper = (await page.locator('#paper-live').boundingBox())!;
  await page.mouse.move(paper.x + 360, paper.y + 320); await page.mouse.down();
  await page.mouse.move(paper.x + 760, paper.y + 320, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => detail.evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i + 2] > data[i] + 80 && data[i + 2] > data[i + 1] + 60) blue++;
    return blue;
  })).toBeGreaterThan(20);
  await page.locator('.paper-viewport').evaluate(viewport => { viewport.scrollTop = 640; });
  await expect.poll(async () => Number.parseFloat(await detail.evaluate(canvas => (canvas as HTMLCanvasElement).style.top))).toBeGreaterThan(0);
  await page.getByRole('button', { name: '보기 옵션' }).click();
  await page.getByRole('button', { name: '화면에 맞춤' }).click();
  await expect(detail).toBeHidden();
  await expect.poll(() => detail.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(0);
});
