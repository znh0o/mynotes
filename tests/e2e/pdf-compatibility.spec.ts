import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test('PDF loads without new Map APIs and home still works after a rendering failure', async ({ context, page }) => {
  await context.addInitScript(() => {
    const removeNewMethods = () => {
      for (const prototype of [Map.prototype, WeakMap.prototype]) {
        Reflect.deleteProperty(prototype, 'getOrInsertComputed'); Reflect.deleteProperty(prototype, 'getOrInsert');
      }
    };
    removeNewMethods();
    // Exercise the actual PDF worker in a realm missing the same browser APIs.
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const absolute = new URL(String(url), location.href).href;
        if (absolute.includes('pdf.worker')) {
          const source = `(${removeNewMethods.toString()})(); await import(${JSON.stringify(absolute)});`;
          super(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { ...options, type: 'module' });
        } else super(url, options);
      }
    };
  });
  await page.goto('./'); await expect(page.locator('h1')).toBeVisible();
  expect(await page.evaluate(() => typeof (Map.prototype as unknown as Record<string, unknown>).getOrInsertComputed)).toBe('undefined');
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText('Compatibility test', { x: 50, y: 700, font, size: 24 });
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'PDF 가져오기', exact: true }).click();
  await (await chooser).setFiles({ name: 'Compatibility PDF.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  expect(await page.evaluate(() => typeof (Map.prototype as unknown as Record<string, unknown>).getOrInsertComputed)).toBe('function');
  const canvas = await page.locator('#paper-live').boundingBox();
  await page.mouse.move(canvas!.x + 100, canvas!.y + 180); await page.mouse.down();
  await page.mouse.move(canvas!.x + 230, canvas!.y + 180, { steps: 15 }); await page.mouse.up();
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await expect(page.locator('h1')).toBeVisible();
  const before = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<any[]>(resolve => { const r = db.transaction('assets').objectStore('assets').getAll(); r.onsuccess = () => resolve(r.result); });
    const id = rows[0].id;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').put({ ...rows[0], blob: new Blob(['intentionally invalid PDF'], { type: 'application/pdf' }) });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close(); return id;
  });
  await page.reload(); await expect(page.locator('h1')).toBeVisible();
  await page.getByRole('button', { name: 'Compatibility PDF 열기', exact: true }).click();
  await expect(page.locator('.page-load-error')).toBeVisible();
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).first().click();
  await expect(page.locator('h1')).toContainText('나의 서재');
  const saved = await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('mynotes-v1'); r.onsuccess = () => resolve(r.result); });
    const pages = await new Promise<any[]>(resolve => { const r = db.transaction('pages').objectStore('pages').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return pages.find(p => p.pdfAssetId === id);
  }, before);
  expect(saved.items).toHaveLength(1); expect(saved.items[0].kind).toBe('stroke');
});
