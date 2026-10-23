import { expect, type Page } from '@playwright/test';

export async function selectPen(page: Page, name: '볼펜' | '만년필' | '연필', touch = false) {
  const trigger = page.getByRole('button', { name: '펜', exact: true });
  if (touch) await trigger.tap(); else await trigger.click();
  const picker = page.getByRole('dialog', { name: '펜 선택' });
  const preset = picker.getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) });
  await expect(preset).toBeVisible();
  if (touch) await preset.tap(); else await preset.click();
  await expect(picker).toBeHidden();
}

export async function setInkColor(page: Page, color: string) {
  await page.getByRole('button', { name: '색상 선택' }).click();
  const picker = page.getByRole('dialog', { name: '색상 선택' });
  await picker.getByRole('textbox', { name: 'HEX 색상 코드' }).fill(color);
  await picker.getByRole('button', { name: '이 색 사용' }).click();
  await expect(picker).toBeHidden();
}
