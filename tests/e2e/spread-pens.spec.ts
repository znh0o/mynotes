import { test, expect, type Page } from './standalone-test';

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
  await expect(pens.locator('.pen-picker-hero .pen-preview')).toBeVisible();
  await expect(pens.locator('.pen-preset-row .pen-preview')).toHaveCount(3);
  const cards = await pens.locator('.pen-preset-row').evaluateAll(rows => rows.map(row => {
    const art = row.querySelector('.pen-preset-art')!.getBoundingClientRect();
    const name = row.querySelector('.pen-preset-name')!.getBoundingClientRect();
    return { x: art.x, y: art.y, bottom: art.bottom, labelTop: name.top };
  }));
  expect(cards[0].x).toBeLessThan(cards[1].x);
  expect(cards[1].x).toBeLessThan(cards[2].x);
  expect(cards[0].y).toBe(cards[1].y);
  expect(cards[0].bottom).toBeLessThan(cards[0].labelTop);
  await expect(pens.locator('.pen-preset-row[aria-pressed=true]')).toHaveCount(1);
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
  const redPencil = pens.getByRole('button', { name: /빨간 연필/ }).locator('.pen-preview');
  await expect(redPencil).toHaveCSS('--ink', '#dd3344');
  await expect(redPencil.locator('.pen-ink-sample path')).toHaveAttribute('stroke', '#dd3344');
  const pencilImage = redPencil.locator('.pen-raster');
  await expect(pencilImage).toHaveAttribute('data-ready', 'true');
  const { graphite, wood } = await pencilImage.evaluate(canvas => {
    const context = (canvas as HTMLCanvasElement).getContext('2d')!;
    return {
      graphite: [...context.getImageData(100, 100, 1, 1).data],
      wood: [...context.getImageData(190, 100, 1, 1).data],
    };
  });
  expect(graphite[0]).toBeGreaterThan(graphite[1] * 2);
  expect(graphite[0]).toBeLessThan(140); // Retain graphite shading instead of a flat red overlay.
  expect(wood[1]).toBeGreaterThan(130); // The pencil body keeps its original color.
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

test('ballpoint and fountain grips change color through their edges without tinting the metal', async ({ page }) => {
  await page.goto('./'); await newNote(page, '손잡이 색 확인');
  await page.getByRole('button', { name: '펜', exact: true }).click();
  const pens = page.getByRole('dialog', { name: '펜 선택' });
  for (const [name, color] of [['볼펜', '#DD3344'], ['만년필', '#27A06B']]) {
    await pens.getByRole('button', { name: '구성 편집' }).click();
    await pens.getByRole('button', { name: `${name} 수정` }).click();
    await pens.locator('[data-action=pen-color]').click();
    const picker = page.getByRole('dialog', { name: '색상 선택' });
    await picker.getByRole('textbox', { name: 'HEX 색상 코드' }).fill(color);
    await picker.getByRole('button', { name: '이 색 사용' }).click();
    await pens.getByRole('button', { name: '펜 저장' }).click();
  }
  const previews = pens.locator('.pen-preset-row .pen-raster');
  await expect(previews).toHaveCount(3);
  await expect(previews.nth(0)).toHaveAttribute('data-ready', 'true');
  await expect(previews.nth(1)).toHaveAttribute('data-ready', 'true');
  const samples = await previews.evaluateAll(canvases => canvases.slice(0, 2).map((canvas, index) => {
    const context = (canvas as HTMLCanvasElement).getContext('2d')!;
    const pixel = (x: number) => [...context.getImageData(x, 100, 1, 1).data];
    return { grip: pixel(index ? 300 : 280), edge: pixel(index ? 360 : 385), body: pixel(440) };
  }));
  expect(samples[0].grip[0]).toBeGreaterThan(samples[0].grip[2] * 1.6);
  expect(samples[0].edge[0]).toBeGreaterThan(samples[0].edge[2] * 1.6);
  expect(samples[1].grip[1]).toBeGreaterThan(samples[1].grip[0] * 1.6);
  expect(samples[1].edge[1]).toBeGreaterThan(samples[1].edge[0] * 1.6);
  for (const sample of samples) expect(Math.abs(sample.body[0] - sample.body[1])).toBeLessThan(12);
});
