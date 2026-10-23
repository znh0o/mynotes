import { test, expect } from '@playwright/test';
test.use({ hasTouch: true });

test('tools switch on the first stylus or touch tap even when compatibility clicks are dropped', async ({ page, context }) => {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('펜 전환'); await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  await page.evaluate(() => {
    const blocker = new AbortController(); (window as any).clickBlocker = blocker;
    document.addEventListener('click', e => {
      if ((e.target as Element).closest('.ink-toolbar button') && e instanceof PointerEvent && ['pen', 'touch'].includes(e.pointerType)) e.stopImmediatePropagation();
    }, { capture: true, signal: blocker.signal });
  });
  const cdp = await context.newCDPSession(page);
  const penTap = async (name: string) => {
    const r = (await page.getByRole('button', { name, exact: true }).boundingBox())!, x = r.x + r.width / 2, y = r.y + r.height / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', buttons: 0, x, y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, x, y, force: .2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, x, y, force: 0, clickCount: 1 });
  };
  for (const name of ['만년필', '볼펜', '만년필', '형광펜']) {
    await penTap(name); await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('.drawing-tools .active').count()).toBe(1);
  }
  for (const name of ['만년필', '지우개', '볼펜']) {
    const r = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  // A normal synthesized click must not undo twice after one pen tap.
  await page.evaluate(() => (window as any).clickBlocker.abort());
  const canvas = (await page.locator('#paper-live').boundingBox())!;
  for (const y of [160, 250]) { await page.mouse.move(canvas.x + 120, canvas.y + y); await page.mouse.down(); await page.mouse.move(canvas.x + 250, canvas.y + y, { steps: 10 }); await page.mouse.up(); }
  await penTap('실행 취소 (Ctrl+Z)');
  await expect(page.getByRole('button', { name: '실행 취소 (Ctrl+Z)', exact: true })).toBeEnabled();
  await cdp.detach();
});

test('pinch and wheel bursts reuse canvas buffers until the gesture ends', async ({ page, context }) => {
  await page.clock.install();
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.locator('.app-slide-layer')).toHaveCount(0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => {
    (window as any).resizes = 0;
    for (const dimension of ['width', 'height']) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension)!;
      Object.defineProperty(HTMLCanvasElement.prototype, dimension, { ...d, set(this: HTMLCanvasElement, value: number) { if (['paper-ink', 'paper-live', 'paper-background'].includes(this.id)) (window as any).resizes++; d.set!.call(this, value); } });
    }
  });
  const v = (await page.locator('.paper-viewport').boundingBox())!, x = v.x + v.width / 2, y = v.y + 230;
  const cdp = await context.newCDPSession(page);
  const points = (distance: number) => [{ id: 1, x: x - distance / 2, y }, { id: 2, x: x + distance / 2, y }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(140) });
  await expect(page.locator('.zoom-preview')).toHaveCount(1);
  for (let i = 0; i < 20; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(140 + i * 8) });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await page.evaluate(() => (window as any).resizes)).toBe(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.zoom-preview')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).resizes)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).resizes)).toBeLessThanOrEqual(6);
  // Keep the 140ms wheel settle timer from expiring between remote assertions
  // on a busy CI runner. Advance browser frames and timer boundaries explicitly.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(() => {
    (window as any).resizes = 0;
    const viewport = document.querySelector('.paper-viewport')!;
    for (let i = 0; i < 30; i++) viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -2, ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await page.clock.runFor(16);
  expect(await page.evaluate(() => (window as any).resizes)).toBe(0);
  await expect(page.locator('.zoom-preview')).toHaveCount(1);
  await page.clock.runFor(160);
  await expect(page.locator('.zoom-preview')).toHaveCount(0, { timeout: 5000 });
  expect(await page.evaluate(() => (window as any).resizes)).toBeLessThanOrEqual(6);
  await cdp.detach();
});

test('editor blocks refresh shortcuts and asks before browser reload while updates remain allowed', async ({ page }) => {
  await page.goto('./'); await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.locator('.app-slide-layer')).toHaveCount(0);
  await page.evaluate(() => (window as any).sameDocument = 'editor-session');
  for (const shortcut of ['F5', 'Control+r', 'Control+Shift+r']) {
    await page.keyboard.press(shortcut);
    expect(await page.evaluate(() => (window as any).sameDocument)).toBe('editor-session');
    await expect(page.locator('#toast')).toContainText('새로고침을 막았어요');
  }
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe('none');
  const cdp = await page.context().newCDPSession(page);
  const prompt = page.waitForEvent('dialog');
  const reload = cdp.send('Page.reload');
  const dialog = await prompt; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); await reload;
  expect(await page.evaluate(() => (window as any).sameDocument)).toBe('editor-session');
  await page.getByRole('button', { name: '서재로 돌아가기', exact: true }).click();
  await expect(page.locator('h1')).toBeVisible();
  await cdp.detach();
});
