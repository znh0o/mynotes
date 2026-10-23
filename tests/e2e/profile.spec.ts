import { test, expect } from './standalone-test';

test('profile opens beside the avatar, saves details, and closes without leaving the library', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /나의 서재/ })).toBeVisible();

  const avatar = page.getByRole('button', { name: '프로필', exact: true });
  const profile = page.getByRole('dialog', { name: '프로필', exact: true });
  await avatar.click();
  await expect(profile).toBeVisible();
  await expect(page.getByRole('dialog', { name: '설정' })).toBeHidden();
  await expect(avatar).toHaveAttribute('aria-expanded', 'true');

  await profile.getByRole('button', { name: '수정' }).click();
  await profile.getByRole('textbox', { name: '이름' }).fill('김가람');
  await profile.getByRole('textbox', { name: '학교' }).fill('한빛고등학교');
  await profile.getByRole('textbox', { name: '학년' }).fill('2학년');
  await profile.getByRole('textbox', { name: '반' }).fill('3반');
  await profile.getByRole('button', { name: '저장' }).click();
  await expect(profile).toContainText('김가람');
  await expect(profile).toContainText('한빛고등학교');
  await expect(profile).toContainText('2학년');
  await expect(profile).toContainText('3반');
  await expect(avatar).toHaveText('김');

  await page.reload();
  await avatar.click();
  await expect(profile).toContainText('한빛고등학교');
  await page.keyboard.press('Escape');
  await expect(profile).toBeHidden();
  await expect(avatar).toHaveAttribute('aria-expanded', 'false');

  await avatar.click();
  await page.goBack();
  await expect(profile).toBeHidden();
  await expect(page.getByRole('heading', { name: /나의 서재/ })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await avatar.click();
  await expect(profile).toBeVisible();
  const box = await profile.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.locator('.library-content').click({ position: { x: 2, y: 2 } });
  await expect(profile).toBeHidden();
});
