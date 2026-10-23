import { test as base, expect, type BrowserContext } from '@playwright/test';

// Existing editor tests run with the same display mode as an installed PWA.
// The browser-mode landing tests import Playwright directly.
export async function emulateStandalone(context: BrowserContext) {
  await context.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (query.trim() !== '(display-mode: standalone)' || sessionStorage.getItem('notelin-e2e-browser') === '1') return nativeMatchMedia(query);
      return {
        media: query, matches: true, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return true; },
      } as MediaQueryList;
    };
  });
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await emulateStandalone(context);
    await use(context);
  },
});

export { expect };
export type { Page, CDPSession } from '@playwright/test';
