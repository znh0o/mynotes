import { test, expect } from './standalone-test';
import { selectPen } from './helpers';

test('pencil width and fixed darkness share the existing row on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click(); await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
  const before = (await page.locator('.paper-viewport').boundingBox())!;
  await selectPen(page, '연필');
  const adjustment = page.locator('#ink-adjustment');
  await adjustment.click();
  await expect(page.locator('#pencil-mode-menu')).toBeVisible();
  await expect(page.locator('[data-action="pencil-mode"][data-id="width"]')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '../MyNotes-pencil-menu.png' });
  await page.locator('[data-action="pencil-mode"][data-id="darkness"]').click();
  await expect(adjustment).toHaveAttribute('aria-label', '연필 조절 항목: 진하기');
  await page.getByRole('slider', { name: '연필 진하기', exact: true }).fill('40');
  await expect(page.locator('#width-value')).toHaveText('40%');
  for (const locator of [adjustment, page.locator('#ink-width'), page.getByRole('button', { name: '필기 옵션', exact: true })]) {
    const r = (await locator.boundingBox())!; expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(390);
  }
  expect(await page.locator('.paper-viewport').boundingBox()).toEqual(before);
  await adjustment.click(); await page.keyboard.press('Escape');
  await expect(page.locator('#pencil-mode-menu')).toBeHidden();
  await adjustment.click(); await page.locator('[data-action="pencil-mode"][data-id="width"]').click();
  await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('3');
  await page.getByRole('slider', { name: '펜 굵기', exact: true }).click();
  expect(await page.locator('#ink-width').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  await page.screenshot({ path: '../MyNotes-pencil-controls.png' });
});

test('writing options preserve canvas space and paper settings open from view options', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 }); await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#app .page-loading')).toBeHidden();
  const addColor = await page.getByRole('button', { name: '색상 선택', exact: true }).evaluate(button => {
    const outer = button.getBoundingClientRect(), plus = button.querySelector('svg')!.getBoundingClientRect();
    return { horizontal: (outer.left + outer.right - plus.left - plus.right) / 2, vertical: (outer.top + outer.bottom - plus.top - plus.bottom) / 2 };
  });
  expect(Math.abs(addColor.horizontal)).toBeLessThan(.6);
  expect(Math.abs(addColor.vertical)).toBeLessThan(.6);
  expect((await page.locator('.ink-toolbar').boundingBox())!.height).toBeLessThanOrEqual(44);
  const noteIndex = await page.evaluate(() => history.state.index);
  const canvas = (await page.locator('.paper-viewport').boundingBox())!;
  const options = page.getByRole('button', { name: '필기 옵션', exact: true });
  await options.click(); await expect(page.getByRole('dialog', { name: '필기 옵션', exact: true })).toBeVisible();
  expect(await page.locator('.paper-viewport').boundingBox()).toEqual(canvas);
  await page.getByText('손가락 필기', { exact: true }).click(); await expect(page.locator('#finger-drawing')).toBeChecked();
  await page.getByRole('button', { name: '필기 옵션 닫기', exact: true }).click(); await expect(options).toHaveAttribute('aria-expanded', 'false');
  await options.click(); await expect(page.locator('#finger-drawing')).toBeChecked();
  await page.getByRole('button', { name: '필기 옵션 닫기', exact: true }).click();
  await page.getByRole('button', { name: '보기 옵션', exact: true }).click();
  await page.getByRole('button', { name: '속지 설정', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.locator('select[name=paper]').selectOption('grid');
  await page.getByRole('button', { name: '적용', exact: true }).click(); await expect(page.locator('#paper-description')).toHaveText('모눈');
  const shapeButton = page.getByRole('button', { name: '도형', exact: true });
  await shapeButton.click();
  await page.getByRole('dialog', { name: '도형 선택' }).getByRole('button', { name: '원 · 타원' }).click();
  await options.click();
  await page.evaluate(() => history.back()); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(options).toHaveAttribute('aria-expanded', 'false');
  await shapeButton.click();
  await expect(page.getByRole('dialog', { name: '도형 선택' }).getByRole('button', { name: '원 · 타원' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('.paper-viewport').boundingBox()).toEqual(canvas);
  await page.screenshot({ path: '../MyNotes-compact-toolbar.png' });
  await expect.poll(() => page.evaluate(() => history.state.index)).toBe(noteIndex);
  await page.evaluate(() => history.back()); await expect(page.locator('#library-title')).toContainText('나의 서재');
});
