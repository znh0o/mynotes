import { test, expect } from '@playwright/test';
test.use({ hasTouch: true });

for (const pointer of ['pen', 'touch'] as const) test(`every button path responds to a short ${pointer} tap without native compatibility clicks`, async ({ page, context }) => {
  await page.addInitScript(() => document.addEventListener('click', event => {
    if (event.detail > 0 && (event.target as Element).closest('button')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true }));
  await page.goto('./'); await expect(page.getByRole('button', { name: '새 노트', exact: true })).toBeVisible();
  const cdp = await context.newCDPSession(page);
  const tap = async (name: string, role: 'button' | 'menuitem' = 'button') => {
    const target = page.getByRole(role, { name, exact: true }); await expect(target).toBeVisible();
    const r = (await target.boundingBox())!, x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (pointer === 'touch') await page.touchscreen.tap(x, y);
    else {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, force: .3, x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, force: 0, x, y });
    }
  };
  await tap('새 노트'); await expect(page.getByRole('dialog')).toBeVisible();
  await tap('취소'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await tap('새 노트'); await page.locator('[name=title]').fill(`짧은 ${pointer} 탭`);
  await tap('노트 만들기'); await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.locator('.app-slide-layer')).toHaveCount(0);
  await tap('연필'); await expect(page.getByRole('button', { name: '연필', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await tap('필기 옵션'); await expect(page.getByRole('dialog')).toBeVisible();
  await tap('필기 옵션 닫기'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await tap('필기 옵션'); await tap('속지 설정'); await expect(page.getByRole('dialog')).toBeVisible();
  await tap('적용'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await tap('노트 설정'); await expect(page.getByRole('dialog')).toBeVisible();
  await tap('완료'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await tap('서재로 돌아가기'); await expect(page.locator('#library-title')).toBeVisible();
  await expect(page.locator('.app-slide-layer')).toHaveCount(0);
  await tap(`짧은 ${pointer} 탭 메뉴`); await expect(page.getByRole('menu')).toBeVisible();
  await tap('이름 변경', 'menuitem'); await expect(page.getByRole('dialog')).toBeVisible();
  await tap('취소'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await tap('설정 및 백업'); await expect(page.getByRole('dialog')).toBeVisible();
  await tap('완료'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await cdp.detach();
});

test('swiping across a button does not activate it', async ({ page }) => {
  await page.goto('./'); const button = page.getByRole('button', { name: '새 노트', exact: true }); await expect(button).toBeVisible();
  await button.evaluate(button => {
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 7, button: 0, clientX: 20, clientY: 20 }));
    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: 60, clientY: 20 }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 7, button: 0, clientX: 60, clientY: 20 }));
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a delayed click landing on a newly opened dialog does not close it', async ({ page }) => {
  await page.goto('./'); const button = page.getByRole('button', { name: '새 노트', exact: true }); await expect(button).toBeVisible();
  const open = await button.evaluate(button => {
    const r = button.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    for (const type of ['pointerdown', 'pointerup']) button.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'pen', pointerId: 7, button: 0, clientX: x, clientY: y }));
    const dialog = document.querySelector('dialog')!;
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y }));
    return dialog.open;
  });
  expect(open).toBe(true); await expect(page.getByRole('dialog')).toBeVisible();
});
