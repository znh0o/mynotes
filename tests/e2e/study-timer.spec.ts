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
  await panel.locator('[data-timer-action=start]').click();
  await expect(panel.locator('.study-timer-status')).toContainText('진행 중');
  await panel.locator('[data-timer-action=select]').click();
  await expect(panel.locator('#study-timer-name')).toHaveValue('국어 복습');
  await expect(panel.locator('.study-timer-clock')).toHaveText('0:06');
  await expect(panel.locator('.study-timer-status')).toContainText('국어 복습 · 시작 대기');
  await panel.locator('[data-timer-action=start]').click();
  await expect(panel.locator('.study-timer-status')).toContainText('진행 중');
  await panel.getByRole('button', { name: '타이머 닫기' }).click();
  const compact = page.locator('.study-timer-mini');
  await expect(compact).toBeVisible();
  await expect(compact.locator('.study-timer-mini-time')).toContainText(/0:0[1-6]/);
  await compact.getByRole('button', { name: '타이머 일시정지' }).click();
  await expect(compact.getByRole('button', { name: '타이머 계속' })).toBeVisible();
  await compact.getByRole('button', { name: '타이머 계속' }).click();
  await expect(compact.getByRole('button', { name: '타이머 일시정지' })).toBeVisible();
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
  await page.locator('#study-timer-panel [data-timer-action=start]').click();
  await page.getByRole('button', { name: '타이머 닫기' }).click();
  await expect(page.locator('.editor-header .study-timer-mini')).toBeVisible();
  const compact = (await page.locator('.editor-header .study-timer-mini').boundingBox())!;
  const actions = (await page.locator('.editor-header-actions').boundingBox())!;
  expect(compact.x + compact.width).toBeLessThanOrEqual(actions.x + 1);
  await expect(page.locator('#paper-live')).toBeVisible();
});

test('each note keeps its own running timer while saved presets stay shared', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('타이머 A');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await page.locator('[data-action=timer]').click();
  const panel = page.locator('#study-timer-panel');
  await panel.locator('#study-timer-name').fill('수학 공부');
  await panel.locator('#study-timer-minutes').fill('2');
  await panel.getByRole('button', { name: '저장', exact: true }).click();
  await panel.locator('[data-timer-action=start]').click();
  await expect(panel.locator('.study-timer-status')).toContainText('수학 공부 · 진행 중');
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();

  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('타이머 B');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await expect(page.locator('.study-timer-mini')).toBeHidden();
  await page.locator('[data-action=timer]').click();
  await expect(panel.locator('.study-timer-preset')).toContainText('수학 공부');
  await expect(panel.locator('.study-timer-clock')).toHaveText('25:00');
  await panel.locator('#study-timer-name').fill('영어 공부');
  await panel.locator('#study-timer-minutes').fill('3');
  await panel.locator('[data-timer-action=start]').click();
  await expect(panel.locator('.study-timer-status')).toContainText('영어 공부 · 진행 중');
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();

  await page.getByRole('button', { name: '타이머 A 열기' }).click();
  await page.locator('[data-action=timer]').click();
  await expect(panel.locator('.study-timer-status')).toContainText('수학 공부 · 진행 중');
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.getByRole('button', { name: '타이머 B 열기' }).click();
  await page.locator('[data-action=timer]').click();
  await expect(panel.locator('.study-timer-status')).toContainText('영어 공부 · 진행 중');
  await expect(panel.locator('.study-timer-preset')).toContainText('수학 공부');
});

test('an older shared running timer moves to one note only', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '새 노트', exact: true }).click();
  await page.locator('[name=title]').fill('이전 타이머 노트');
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click();
  await page.getByRole('button', { name: '서재로 돌아가기' }).click();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mynotes-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put({ key: 'study-timer-state', value: { name: '이전 타이머', seconds: 120, remaining: 120, endsAt: Date.now() + 120000, finished: false } });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.getByRole('button', { name: '이전 타이머 노트 열기' }).click();
  await page.locator('[data-action=timer]').click();
  await expect(page.locator('.study-timer-status')).toContainText('이전 타이머 · 진행 중');
  const migrated = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('mynotes-v1'); request.onsuccess = () => resolve(request.result); });
    const settings = await new Promise<Array<{ key: string }>>(resolve => { const request = database.transaction('settings').objectStore('settings').getAll(); request.onsuccess = () => resolve(request.result); });
    database.close();
    return settings.filter(row => row.key.startsWith('study-timer-state')).map(row => row.key);
  });
  expect(migrated).toHaveLength(1);
  expect(migrated[0]).toMatch(/^study-timer-state:/);
});
