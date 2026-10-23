import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 1280 }]) {
  test(`Android tablet touch typing controls and start position at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36' });
    try {
      const page = await context.newPage(); await page.goto('./');
      await page.getByRole('button', { name: '새 노트', exact: true }).tap(); await page.locator('[name=title]').fill('태블릿 타이핑');
      await page.getByRole('button', { name: '노트 만들기', exact: true }).tap();
      await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
      await page.getByRole('button', { name: '텍스트', exact: true }).tap();
      const input = page.getByRole('textbox', { name: '페이지에 글 입력' }), size = page.getByRole('slider', { name: '글자 크기', exact: true });
      await expect(input, await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 250))).toBeFocused(); await expect(size).toHaveValue('22');
      expect((await input.boundingBox())!.height).toBeLessThan(100);
      const checkOrigin = async () => {
        const paper = (await page.locator('#paper-live').boundingBox())!, field = (await input.boundingBox())!, scale = paper.width / 794;
        expect(field.x - paper.x).toBeCloseTo(48 * scale, 0); expect(field.y - paper.y).toBeCloseTo(64 * scale, 0);
      };
      await checkOrigin();
      await page.getByRole('button', { name: '글자 크기 늘리기', exact: true }).tap();
      await expect(size).toHaveValue('23'); await expect(input).toHaveCSS('font-size', '23px');
      await expect(input).toBeFocused();
      const cdp = await context.newCDPSession(page), r = (await size.boundingBox())!;
      const x = r.x + 10 + (r.width - 20) * (30 - 10) / 90, y = r.y + r.height / 2;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, x: r.x + 10, y, force: .5, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', buttons: 1, x, y, force: .5 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, x, y, force: 0, clickCount: 1 });
      await expect(size).toHaveValue('30'); await expect(input).toHaveCSS('font-size', '30px');
      await expect(input).toBeFocused();
      const exactSize = page.getByRole('spinbutton', { name: '글자 크기', exact: true });
      await exactSize.tap();
      await expect.poll(() => exactSize.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 2]);
      await page.keyboard.insertText('28'); await page.keyboard.press('Enter');
      await expect(exactSize).toHaveValue('28'); await expect(size).toHaveValue('28'); await expect(input).toHaveCSS('font-size', '28px');
      await expect(input).toBeFocused();
      await cdp.send('Input.imeSetComposition', { text: '태', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.insertText', { text: '태블릿 첫 줄\n다음 줄' });
      await expect(input).toHaveValue('태블릿 첫 줄\n다음 줄');
      await exactSize.tap(); await page.keyboard.insertText('31');
      await page.getByRole('button', { name: '타이핑 글자 크게', exact: true }).tap();
      await expect(input).toHaveCSS('font-size', '32px'); await expect(exactSize).toHaveValue('32');
      await exactSize.tap(); await page.keyboard.insertText('41');
      await page.getByRole('button', { name: '글자 크기 늘리기', exact: true }).tap();
      await expect(input).toHaveCSS('font-size', '42px'); await expect(exactSize).toHaveValue('42');
      await exactSize.tap(); await page.keyboard.insertText('28'); await page.keyboard.press('Enter');
      // Resize text that already exists, with the keyboard/IME session open.
      const originalHeight = (await input.boundingBox())!.height;
      await exactSize.tap(); await page.keyboard.insertText('48'); await page.keyboard.press('Enter');
      await expect(input).toHaveValue('태블릿 첫 줄\n다음 줄'); await expect(input).toHaveCSS('font-size', '48px');
      expect((await input.boundingBox())!.height).toBeGreaterThan(originalHeight * 1.6);
      await page.getByRole('button', { name: '타이핑 글자 작게', exact: true }).tap();
      await expect(input).toHaveCSS('font-size', '47px'); await expect(input).toBeFocused();
      await page.getByRole('button', { name: '타이핑 글자 크게', exact: true }).tap();
      await expect(input).toHaveCSS('font-size', '48px'); await expect(input).toBeFocused();
      await page.keyboard.insertText(' 추가 입력');
      await expect(input).toHaveValue('태블릿 첫 줄\n다음 줄 추가 입력');
      await exactSize.tap(); await page.keyboard.insertText('28'); await page.keyboard.press('Enter');
      await page.setViewportSize({ width: viewport.width, height: viewport.height - 300 });
      await checkOrigin(); expect(await page.locator('.paper-viewport').evaluate(el => el.scrollTop)).toBeLessThan(2);
      await input.fill(Array.from({ length: 18 }, (_, i) => `${i + 1}번째 줄`).join('\n'));
      await page.getByRole('button', { name: '서재로 돌아가기' }).tap(); await expect(page.locator('#library-title')).toBeVisible();
      await page.setViewportSize(viewport); await page.getByRole('button', { name: '태블릿 타이핑 열기', exact: true }).tap();
      await expect(page.locator('#paper-live')).toBeVisible(); await expect(page.locator('.page-loading')).toBeHidden();
      await page.getByRole('button', { name: '텍스트', exact: true }).tap();
      await expect(input).toHaveCSS('font-size', '28px'); await expect(size).toHaveValue('28');
      expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(0);
      expect(await page.locator('.paper-viewport').evaluate(el => el.scrollTop)).toBeLessThan(2);
      await checkOrigin();
      await page.getByRole('button', { name: '볼펜', exact: true }).tap();
      await expect(page.getByRole('slider', { name: '펜 굵기', exact: true })).toHaveValue('3');
      await page.screenshot({ path: `../MyNotes-tablet-typing-${viewport.width}.png` });
    } finally { await context.close(); }
  });
}
