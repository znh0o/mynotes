import { test, expect } from '@playwright/test';

test('long pencil input leaves time for a toolbar tap', async ({ page, context }) => {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden(); await expect(page.locator('.app-slide-layer')).toHaveCount(0);
  await page.getByRole('button', { name: '연필', exact: true }).click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r = (await page.locator('#paper-live').boundingBox())!;
  await page.evaluate(() => document.querySelector('#paper-live')!.addEventListener('pointerdown', e => (window as any).testPointer = (e as PointerEvent).pointerId, { once: true }));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, force: .65, x: r.x + 100, y: r.y + 100 });
  const measured = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#paper-live')!, r = canvas.getBoundingClientRect();
    let commands = 0; const original = Path2D.prototype.lineTo;
    Path2D.prototype.lineTo = function (...args) { commands++; return original.apply(this, args); };
    const samples: { commands: number; ms: number }[] = [];
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => raf(time => {
      const start = performance.now(), before = commands; callback(time);
      samples.push({ commands: commands - before, ms: performance.now() - start });
    });
    try {
      for (let frame = 0; frame < 90; frame++) {
        for (let n = 0; n < 20; n++) {
          const i = frame * 20 + n;
          canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: (window as any).testPointer, pointerType: 'pen', buttons: 1, pressure: .65,
            clientX: r.x + 100 + i * .2, clientY: r.y + 150 + Math.sin(i / 12) * 35 }));
        }
        await new Promise<void>(resolve => raf(() => resolve()));
      }
    } finally { window.requestAnimationFrame = raf; Path2D.prototype.lineTo = original; }
    return samples;
  });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, x: r.x + 460, y: r.y + 150, force: 0 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log('pencil frames', JSON.stringify({ first: measured.slice(0, 3), last: measured.slice(-3), max: Math.max(...measured.map(s => s.ms)) }));
  expect(Math.max(...measured.slice(3).map(s => s.commands))).toBeLessThan(2500);
  await page.getByRole('button', { name: '볼펜', exact: true }).click();
  await expect(page.getByRole('button', { name: '볼펜', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await cdp.detach();
});

test('rapid stylus taps ignore delayed clicks from every earlier button', async ({ page }) => {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click(); await expect(page.locator('.page-loading')).toBeHidden();
  const tool = await page.evaluate(() => {
    for (const id of ['fountain', 'highlighter']) {
      const button = document.querySelector<HTMLElement>(`[data-action=tool][data-id=${id}]`)!;
      for (const type of ['pointerdown', 'pointerup']) button.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'pen', pointerId: 9, button: 0 }));
    }
    for (const id of ['fountain', 'highlighter']) document.querySelector(`[data-action=tool][data-id=${id}]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    return document.querySelector('.drawing-tools .active')?.getAttribute('data-id');
  });
  expect(tool).toBe('highlighter');
});

test('library stylus actions and settings open before storage estimates resolve', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: '설정 및 백업', exact: true })).toBeVisible();
  const opened = await page.evaluate(() => {
    navigator.storage.estimate = () => new Promise(() => {});
    navigator.storage.persisted = () => new Promise(() => {});
    const button = document.querySelector<HTMLElement>('.library-sidebar [data-action=settings]')!;
    for (const type of ['pointerdown', 'pointerup']) button.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'pen', pointerId: 9, button: 0 }));
    return !!document.querySelector('dialog[open]');
  });
  expect(opened).toBe(true);
  await expect(page.getByRole('dialog')).toBeVisible();
});
