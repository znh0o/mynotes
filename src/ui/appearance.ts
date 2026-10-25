export type Appearance = 'light' | 'dark' | 'system';
const key = 'notelin-appearance';
const valid = (value: unknown): Appearance => value === 'light' || value === 'dark' ? value : 'system';
let preference: Appearance = 'system';
let system: MediaQueryList;

function apply() {
  const dark = preference === 'dark' || preference === 'system' && system.matches;
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.style.backgroundColor = dark ? '#0e1624' : '#f4f7ff';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151f30' : '#f4f7ff');
  document.querySelectorAll<HTMLElement>('[data-appearance]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.appearance === preference)));
}

export function initAppearance() {
  try { preference = valid(localStorage.getItem(key)); } catch { /* The theme still works when storage is unavailable. */ }
  system = matchMedia('(prefers-color-scheme: dark)');
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => { if (event.key === key) { preference = valid(event.newValue); apply(); } });
  apply();
}

export function getAppearance() { return preference; }
export function setAppearance(value: Appearance) {
  preference = valid(value);
  try { localStorage.setItem(key, preference); } catch { /* Keep the current session usable. */ }
  apply();
}
