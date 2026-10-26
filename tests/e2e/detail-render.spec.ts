import { test, expect } from './standalone-test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { setInkColor } from './helpers';

test.use({ deviceScaleFactor: 2.5, viewport: { width: 1280, height: 800 } });

test('zoomed PDF and ink use a sharp visible tile instead of enlarging the capped page canvas', async ({ page }) => {
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
    let dark = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i] < 80 && data[i + 3] > 200) dark++;
    return { dpr: devicePixelRatio, baseDensity: base.width / base.getBoundingClientRect().width,
      detailDensity: tile.width / tile.getBoundingClientRect().width, pixels: tile.width * tile.height, dark };
  });
  expect(sizes.baseDensity).toBeLessThan(.9);
  expect(sizes.detailDensity).toBeGreaterThan(sizes.baseDensity * 1.1);
  expect(sizes.detailDensity).toBeGreaterThan(2.4);
  expect(sizes.pixels).toBeLessThan(8100000);
  expect(sizes.dark).toBeGreaterThan(50);
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
