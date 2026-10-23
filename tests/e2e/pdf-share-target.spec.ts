import { test, expect } from './standalone-test';
import { PDFDocument } from 'pdf-lib';

test('an installed PWA receives a shared PDF and opens it as a note', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('h1')).toContainText('나의 서재');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  expect(manifest.share_target).toEqual({
    action: '/mynotes/share-target', method: 'POST', enctype: 'multipart/form-data',
    params: { files: [{ name: 'pdf', accept: ['application/pdf', '.pdf'] }] }
  });

  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  const bytes = Array.from(await pdf.save());
  const redirect = await page.evaluate(async data => {
    const form = new FormData();
    form.append('pdf', new File([new Uint8Array(data)], '공유 시험.pdf', { type: 'application/pdf' }));
    const response = await fetch('share-target', { method: 'POST', body: form });
    return response.url;
  }, bytes);
  expect(redirect).toMatch(/\/mynotes\/\?shared-pdf=[0-9a-f-]{36}$/i);
  await page.goto(redirect);
  await expect(page.locator('#paper-live')).toBeVisible();
  await expect(page.locator('.page-loading')).toBeHidden();
  await expect.poll(() => page.evaluate(async () => {
    const notes = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mynotes-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await new Promise<string[]>((resolve, reject) => {
      const request = notes.transaction('notes').objectStore('notes').getAll();
      request.onsuccess = () => resolve(request.result.map((note: { title: string }) => note.title));
      request.onerror = () => reject(request.error);
    }); } finally { notes.close(); }
  })).toContain('공유 시험');
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('notelin-shared-pdfs-v1')).keys()).length)).toBe(0);
  expect(new URL(page.url()).searchParams.has('shared-pdf')).toBe(false);
});

test('the installed app can receive a shared PDF while offline', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const pdf = await PDFDocument.create(); pdf.addPage([500, 700]);
  await context.setOffline(true);
  await page.evaluate(data => {
    const form = document.createElement('form');
    form.action = 'share-target'; form.method = 'POST'; form.enctype = 'multipart/form-data';
    const input = document.createElement('input'); input.type = 'file'; input.name = 'pdf';
    const files = new DataTransfer();
    files.items.add(new File([new Uint8Array(data)], '오프라인 공유.pdf', { type: 'application/pdf' }));
    input.files = files.files; form.append(input); document.body.append(form); form.submit();
  }, Array.from(await pdf.save()));
  await expect(page.locator('#paper-live')).toBeVisible();
  await expect(page.locator('.page-loading')).toBeHidden();
  expect(new URL(page.url()).searchParams.has('shared-pdf')).toBe(false);
});
