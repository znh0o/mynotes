import { test, expect, type Page } from '@playwright/test';

async function newNote(page: Page, title: string) {
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill(title);
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.page-loading')).toBeHidden();
}
async function records(page: Page, store: string) {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mynotes-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await new Promise<any[]>((resolve, reject) => {
      const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }); } finally { db.close(); }
  }, store);
}

test('two-page view displays pairs, switches the editable page, and remembers the view', async ({ page }) => {
  await page.goto('./'); await newNote(page, '두 페이지 확인');
  for (let number = 2; number <= 4; number++) {
    await page.getByRole('button', { name: '페이지 추가', exact: true }).last().click();
    await expect(page.locator('.page-position')).toHaveText(`${number} / ${number}`);
  }
  await page.getByRole('button', { name: '1페이지', exact: true }).click();
  await page.getByRole('button', { name: '두 페이지 보기' }).click();
  await expect(page.locator('.paper-stage')).toHaveClass(/two-page/);
  await expect(page.locator('.page-position')).toHaveText('1–2 / 4');
  const companion = page.getByRole('button', { name: '2페이지 선택하여 필기' });
  await expect(companion).toBeVisible();
  const left = (await page.locator('.paper-sizing').boundingBox())!, right = (await companion.boundingBox())!;
  expect(left.x + left.width).toBeLessThan(right.x);

  await companion.click();
  await expect(page.locator('.paper-sizing .spread-page-number')).toHaveText('2');
  const canvas = page.locator('#paper-live'), box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 65, box.y + 75); await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 95, { steps: 12 }); await page.mouse.up();
  await page.getByRole('button', { name: '1페이지 선택하여 필기' }).click();
  await expect.poll(() => page.locator('.spread-ink').evaluate(canvas => {
    const element = canvas as HTMLCanvasElement, ctx = element.getContext('2d')!;
    const pixels = ctx.getImageData(0, 0, element.width, element.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) return true;
    return false;
  })).toBe(true);
  await page.getByRole('button', { name: '다음 페이지' }).click();
  await expect(page.locator('.page-position')).toHaveText('3–4 / 4');
  await page.getByRole('button', { name: '이전 페이지' }).click();
  await expect(page.locator('.page-position')).toHaveText('1–2 / 4');
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.getByRole('button', { name: '두 페이지 확인 열기' }).click();
  await expect(page.locator('.paper-stage')).toHaveClass(/two-page/);
  await page.getByRole('button', { name: '한 페이지 보기' }).click();
  await expect(page.locator('.paper-stage')).not.toHaveClass(/two-page/);
});

test('custom palette and combined pen presets stay separate for each note', async ({ page }) => {
  await page.goto('./'); await newNote(page, '프리셋 노트');
  await page.getByRole('button', { name: '기본 색상 편집' }).click();
  const colors = page.getByRole('dialog', { name: '기본 색상 편집' });
  await expect(colors.locator('.color-picker-square')).toBeVisible();
  await colors.getByRole('textbox', { name: 'HEX 색상 코드' }).fill('#B82D36');
  await colors.getByRole('button', { name: '색상 저장' }).click();
  await expect(page.locator('[data-action=color]').first()).toHaveAttribute('data-id', '#b82d36');

  await page.getByRole('button', { name: '펜', exact: true }).click();
  const pens = page.getByRole('dialog', { name: '펜 선택' });
  await expect(pens.locator('.pen-preset-row')).toHaveCount(3);
  await pens.getByRole('button', { name: '펜 추가' }).click();
  await pens.locator('#pen-edit-name').fill('빨간 연필');
  await pens.getByRole('button', { name: '연필', exact: true }).click();
  await pens.locator('[data-action=pen-color]').click();
  const picker = page.getByRole('dialog', { name: '색상 선택' });
  await picker.getByRole('textbox', { name: 'HEX 색상 코드' }).fill('#DD3344');
  await picker.getByRole('button', { name: '이 색 사용' }).click();
  await expect(pens).toBeVisible();
  await pens.locator('#pen-edit-width').fill('2.5');
  await pens.locator('#pen-edit-darkness').fill('75');
  await pens.getByRole('button', { name: '펜 저장' }).click();
  await expect(pens.getByRole('button', { name: /빨간 연필/ })).toBeVisible();
  await expect(page.locator('#ink-width')).toHaveValue('2.5');
  await pens.getByRole('button', { name: '펜 메뉴 닫기' }).click();
  const canvas = (await page.locator('#paper-live').boundingBox())!;
  await page.mouse.move(canvas.x + 70, canvas.y + 100); await page.mouse.down();
  await page.mouse.move(canvas.x + 170, canvas.y + 115, { steps: 12 }); await page.mouse.up();
  await page.locator('#save-status').click();
  const strokes = (await records(page, 'pages')).flatMap(row => row.items).filter(item => item.kind === 'stroke');
  expect(strokes).toContainEqual(expect.objectContaining({ tool: 'pencil', color: '#dd3344', width: 2.5, pencilDarkness: .75 }));
  await page.getByRole('button', { name: '펜', exact: true }).click();
  await pens.getByRole('button', { name: '구성 편집' }).click();
  await pens.getByRole('button', { name: '빨간 연필 위로' }).click();
  await expect(pens.locator('.pen-arrange-name').nth(2)).toHaveText('빨간 연필');
  await pens.getByRole('button', { name: '완료' }).click();
  await pens.getByRole('button', { name: '펜 메뉴 닫기' }).click();

  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await newNote(page, '다른 노트');
  await page.getByRole('button', { name: '펜', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '펜 선택' }).locator('.pen-preset-row')).toHaveCount(3);
  await page.getByRole('button', { name: '펜 메뉴 닫기' }).click();
  await expect(page.locator('[data-action=color]').first()).not.toHaveAttribute('data-id', '#b82d36');
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.getByRole('button', { name: '프리셋 노트 열기' }).click();
  await page.getByRole('button', { name: '펜', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '펜 선택' }).getByRole('button', { name: /빨간 연필/ })).toBeVisible();
  await expect(page.locator('[data-action=color]').first()).toHaveAttribute('data-id', '#b82d36');
});
