import { test, expect } from '@playwright/test';

test('writing options preserve canvas space and keep finger, paper and tool settings accessible', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 }); await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('#app .page-loading')).toBeHidden();
  const canvas = (await page.locator('.paper-viewport').boundingBox())!;
  const options = page.getByRole('button', { name: '필기 옵션', exact: true });
  await options.click(); await expect(page.getByRole('dialog', { name: '필기 옵션', exact: true })).toBeVisible();
  expect(await page.locator('.paper-viewport').boundingBox()).toEqual(canvas);
  await page.getByText('손가락 필기', { exact: true }).click(); await expect(page.locator('#finger-drawing')).toBeChecked();
  await page.getByRole('button', { name: '필기 옵션 닫기', exact: true }).click(); await expect(options).toHaveAttribute('aria-expanded', 'false');
  await options.click(); await expect(page.locator('#finger-drawing')).toBeChecked();
  await page.getByRole('button', { name: '속지 설정', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.locator('select[name=paper]').selectOption('grid');
  await page.getByRole('button', { name: '적용', exact: true }).click(); await expect(page.locator('#paper-description')).toHaveText('모눈');
  await page.getByRole('button', { name: '도형', exact: true }).click(); await options.click();
  await page.getByRole('combobox', { name: '도형 종류', exact: true }).selectOption('ellipse');
  await page.evaluate(() => history.back()); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#paper-live')).toBeVisible(); await expect(options).toHaveAttribute('aria-expanded', 'false');
  await options.click(); await expect(page.getByRole('combobox', { name: '도형 종류', exact: true })).toHaveValue('ellipse');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('.paper-viewport').boundingBox()).toEqual(canvas);
  await page.screenshot({ path: '../MyNotes-compact-toolbar.png' });
});
