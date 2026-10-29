import { test, expect } from './standalone-test';

test('named study timers remain available across notes and a running countdown survives reopening', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('타이머 첫 노트');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
  await page.locator('[data-action=timer]').click();
  const panel = page.locator('#study-timer-panel');
  await expect(panel).toBeVisible();
  await panel.locator('#study-timer-name').fill('국어 복습');
  await panel.locator('#study-timer-minutes').fill('0');
  await panel.locator('#study-timer-seconds').fill('6');
  await panel.getByRole('button', { name: '저장', exact: true }).click();
  await expect(panel.locator('.study-timer-preset')).toContainText('국어 복습');
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('타이머 둘째 노트');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await page.locator('[data-action=timer]').click();
  await expect(panel.locator('.study-timer-preset')).toContainText('국어 복습');
  await panel.locator('[data-timer-action=select]').click();
  await expect(panel.locator('#study-timer-name')).toHaveValue('국어 복습');
  await panel.locator('[data-timer-action=start]').click();
  await expect(panel.locator('.study-timer-status')).toContainText('진행 중');
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.getByRole('button', { name: '타이머 둘째 노트 열기' }).click();
  await page.locator('[data-action=timer]').click();
  await expect(panel.locator('.study-timer-status')).toContainText('국어 복습');
  await expect(panel.locator('.study-timer-status')).toContainText('완료', { timeout: 10000 });
});

test('phone document menu can open the timer without covering the writing area', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await page.getByRole('button', { name: '문서 메뉴' }).click();
  await page.locator('[data-action=timer]').click();
  await expect(page.locator('#study-timer-panel')).toBeVisible();
  await expect(page.locator('#paper-live')).toBeVisible();
});
