import { test, expect } from './standalone-test';

test('broad contacts and pen-adjacent touches do not draw or trigger a pinch', async ({ page, context }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible();
  await expect(page.locator('.page-loading')).toBeHidden();
  await page.getByRole('button', { name: '필기 옵션', exact: true }).click();
  await page.getByText('손가락 필기', { exact: true }).click();
  await page.getByRole('button', { name: '필기 옵션 닫기', exact: true }).click();
  const rect = (await page.locator('#paper-live').boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const contact = (id: number, x: number, radius: number) =>
    ({ id, x: rect.x + x, y: rect.y + 190, radiusX: radius, radiusY: radius, force: .5 });
  const undo = page.getByRole('button', { name: '실행 취소 (Ctrl+Z)' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact(1, 120, 25)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact(1, 220, 25)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(undo).toBeDisabled();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact(6, 120, 3)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact(6, 220, 25)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(undo).toBeDisabled();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact(2, 140, 25), contact(3, 340, 25)] });
  await expect(page.locator('.zoom-preview')).toHaveCount(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', buttons: 0,
    force: 0, x: rect.x + 180, y: rect.y + 190 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact(4, 180, 3)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact(4, 260, 3)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(undo).toBeDisabled();
  await page.waitForTimeout(850);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact(5, 130, 3)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact(5, 250, 3)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(undo).toBeEnabled();
  await cdp.detach();
});
