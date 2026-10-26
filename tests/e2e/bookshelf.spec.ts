import { test, expect, emulateStandalone, type Page } from './standalone-test';

async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: '새 폴더 만들기' }).click();
  await page.locator('[name=name]').fill(name);
  await page.getByRole('button', { name: '폴더 만들기', exact: true }).click();
  await expect(page.locator('.folder-nav .nav-item').filter({ hasText: name })).toBeVisible();
}

async function createNote(page: Page, name: string) {
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill(name);
  await page.getByRole('button', { name: '노트 만들기' }).click();
  await expect(page.locator('#app .page-loading')).toBeHidden();
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await expect(page.locator('#library-title')).toBeVisible();
}

test('bookshelf selection leaves neighboring books still and a second tap opens the existing editor', async ({ page }) => {
  await page.goto('./');
  await createFolder(page, '국어');
  await createFolder(page, '수학');
  await page.locator('.folder-nav .nav-item').filter({ hasText: '국어' }).click();
  await createNote(page, '중간 문법 추가 프린트');
  await createNote(page, '국어 필기');
  await page.locator('.folder-nav .nav-item').filter({ hasText: '수학' }).click();
  await createNote(page, '수학 정리');
  await page.locator('.library-sidebar [data-id=all]').first().click();
  await page.locator('[data-action=library-mode][data-id=bookshelf]').click();
  await expect(page.locator('.library-sidebar')).toBeHidden();
  const shelf = page.locator('.bookshelf-tier').first();
  await expect(page.locator('.book-spine')).toHaveCount(4);
  const recent = await page.locator('.book-title').allTextContents();
  await page.getByRole('button', { name: '폴더순', exact: true }).click();
  await expect.poll(() => page.locator('.book-title').allTextContents()).toEqual(['국어 필기', '중간 문법 추가 프린트', '수학 정리', recent.at(-1)!]);
  await page.getByRole('button', { name: '최근순', exact: true }).click();
  await page.screenshot({ path: '../Notelin-bookshelf-preview.png', fullPage: true });
  await expect(page.locator('.notebook-cover')).toHaveCount(0);
  const first = page.getByRole('button', { name: '중간 문법 추가 프린트 열기' });
  const second = page.getByRole('button', { name: '국어 필기 열기' });
  const neighbor = await second.boundingBox();
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.editor-shell')).toHaveCount(0);
  expect(await second.boundingBox()).toMatchObject({ x: neighbor!.x, y: neighbor!.y });
  await second.click();
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await shelf.locator('.shelf-well').click({ position: { x: 8, y: 8 } });
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  const transition = page.locator('.book-transition-overlay');
  await first.click();
  await expect(transition).toBeVisible();
  expect(await transition.evaluate(element => document.elementFromPoint(8, 8) === element)).toBe(true);
  await expect(page.locator('#app .page-loading')).toBeHidden();
  await expect(transition).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('#paper-live')).toBeVisible();
});

test('touch reordering preserves the two-tap opening gesture with reduced motion', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await emulateStandalone(context);
  const page = await context.newPage();
  try {
    await page.goto('./');
    await createNote(page, '터치로 옮길 책');
    await createNote(page, '두 번째 터치 책');
    await page.locator('[data-action=library-mode][data-id=bookshelf]').tap();
    await page.getByRole('button', { name: '사용자 지정', exact: true }).tap();
    const titles = () => page.locator('.book-title').allTextContents();
    const before = await titles();
    await page.locator('.book-spine').first().tap();
    expect(await page.locator('.book-move').first().evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    const handle = (await page.locator('.book-move').first().boundingBox())!;
    const target = (await page.locator('.book-slot').last().boundingBox())!;
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + target.width - 2, y: target.y + target.height - 15 }] });
    await expect(page.locator('.book-drag-ghost')).toBeVisible();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(titles).toEqual([...before.slice(1), before[0]]);
    await page.locator('.shelf-well').first().tap({ position: { x: 8, y: 8 } });
    const book = page.locator('#app .book-spine').last();
    await book.tap();
    await expect(book).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.editor-shell')).toHaveCount(0);
    await book.tap();
    await expect(page.locator('#paper-live')).toBeVisible();
    await expect(page.locator('.book-transition-overlay')).toHaveCount(0);
  } finally { await context.close(); }
});

test('custom book positions survive reopening and switching sort modes', async ({ page }) => {
  await page.goto('./');
  for (const name of ['자리를 옮길 노트', '두 번째 책', '세 번째 책']) await createNote(page, name);
  await page.locator('[data-action=library-mode][data-id=bookshelf]').click();
  const titles = () => page.locator('.book-title').allTextContents();
  const recent = await titles();
  await page.getByRole('button', { name: '사용자 지정', exact: true }).click();
  const moving = page.getByRole('button', { name: `${recent[0]} 자리 바꾸기`, exact: true });
  const start = (await moving.boundingBox())!;
  const end = (await page.locator('.book-slot').last().boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 2, end.y + end.height - 15, { steps: 12 });
  await expect(page.locator('.book-drag-ghost')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.book-drag-ghost')).toHaveCount(0);
  await expect.poll(titles).toEqual([...recent.slice(1), recent[0]]);
  await page.getByRole('button', { name: '최근순', exact: true }).click();
  await expect.poll(titles).toEqual(recent);
  await page.getByRole('button', { name: '사용자 지정', exact: true }).click();
  await expect.poll(titles).toEqual([...recent.slice(1), recent[0]]);
  await page.reload();
  await expect(page.getByRole('button', { name: '사용자 지정', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(titles).toEqual([...recent.slice(1), recent[0]]);
  await page.locator('.book-move').last().focus();
  await page.keyboard.press('Home');
  await expect.poll(titles).toEqual(recent);
});

test('the bookshelf remains usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.locator('[data-action=library-mode][data-id=bookshelf]').click();
  await expect(page.locator('.shelf-mobile-search')).toBeVisible();
  await expect(page.locator('.bookshelf-compartment').first()).toBeVisible();
  await expect(page.locator('.library-sidebar')).toBeHidden();
});

test('library view choice is saved and the earlier card library remains available', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.notes-grid')).toBeVisible();
  await page.locator('[data-action=library-mode][data-id=bookshelf]').click();
  await expect(page.locator('.bookshelf-tier')).toBeVisible();
  await page.reload();
  await expect(page.locator('.bookshelf-tier')).toBeVisible();
  await page.locator('[data-action=library-mode][data-id=classic]').click();
  await expect(page.locator('.notes-grid')).toBeVisible();
  await expect(page.locator('.library-sidebar')).toBeVisible();
});
