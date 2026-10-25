import { test, expect } from './standalone-test';

test('tablet PWA starts fullscreen without an editor toggle, while phone chrome stays compact', async ({ page }) => {
  await page.goto('./');
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href)).json());
  expect(manifest.display).toBe('fullscreen');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  await expect(page.locator('[data-action=fullscreen]')).toHaveCount(0);
  expect((await page.locator('.editor-header').boundingBox())!.height).toBe(38);
  await page.getByRole('button', { name: '보기 옵션' }).click();
  await expect(page.locator('#view-options-panel')).toBeVisible();
  await page.getByRole('button', { name: '보기 옵션' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).toHaveAttribute('data-device-ui', 'phone');
  expect((await page.locator('.editor-header').boundingBox())!.height).toBe(48);
  await page.getByRole('button', { name: '문서 메뉴' }).click();
  await expect(page.locator('[data-action=fullscreen]')).toHaveCount(0);
});
