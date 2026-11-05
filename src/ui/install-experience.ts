import { getAppearance, setAppearance, type Appearance } from './appearance';
import { initInstallDemo } from './install-demo';

const siteUrl = 'https://znh0o.github.io/mynotes/';

export function initInstallExperience(root: HTMLElement) {
  const page = root.querySelector<HTMLElement>('.install-page')!;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!reducedMotion.matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) entry.target.classList.toggle('is-visible', entry.isIntersecting && entry.intersectionRatio >= .12);
    }, { threshold: .12 });
    page.classList.add('install-motion');
    root.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
    reducedMotion.addEventListener('change', event => {
      if (event.matches) { observer.disconnect(); page.classList.remove('install-motion'); }
    });
  }
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('.install-preview-tabs [role="tab"]')];
  function selectTab(selected: HTMLButtonElement) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      root.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`)!.hidden = !active;
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); selectTab(tabs[next]); tabs[next].focus();
    });
  });
  const menuToggle = root.querySelector<HTMLButtonElement>('.install-menu-toggle')!;
  const nav = root.querySelector<HTMLElement>('.install-nav')!;
  function closeMenu() { nav.classList.remove('is-open'); menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', '메뉴 열기'); }
  menuToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open'); menuToggle.setAttribute('aria-expanded', String(open)); menuToggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
  });
  root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => link.addEventListener('click', event => {
    const target = root.querySelector<HTMLElement>(link.hash); if (!target) return;
    event.preventDefault(); closeMenu();
    if (link.hash === '#top') window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    else target.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    target.tabIndex = -1; target.focus({ preventScroll: true });
  }));
  const appearanceToggle = root.querySelector<HTMLButtonElement>('.install-appearance-toggle')!;
  const appearanceMenu = root.querySelector<HTMLElement>('.install-appearance-menu')!;
  function closeAppearance() { appearanceMenu.hidden = true; appearanceToggle.setAttribute('aria-expanded', 'false'); }
  root.querySelectorAll<HTMLButtonElement>('[data-appearance]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.appearance === getAppearance()));
    button.addEventListener('click', () => { setAppearance(button.dataset.appearance as Appearance); closeAppearance(); appearanceToggle.focus(); });
  });
  appearanceToggle.addEventListener('click', () => { appearanceMenu.hidden = !appearanceMenu.hidden; appearanceToggle.setAttribute('aria-expanded', String(!appearanceMenu.hidden)); });
  document.addEventListener('pointerdown', event => {
    if (!root.querySelector('.install-appearance')?.contains(event.target as Node)) closeAppearance();
    if (!root.querySelector('.install-header')?.contains(event.target as Node)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (nav.classList.contains('is-open')) { closeMenu(); menuToggle.focus(); }
    if (!appearanceMenu.hidden) { closeAppearance(); appearanceToggle.focus(); }
  });
  const lightbox = root.querySelector<HTMLDialogElement>('.install-lightbox')!;
  root.querySelector('.install-expand')!.addEventListener('click', () => {
    const source = root.querySelector<HTMLImageElement>('[role="tabpanel"]:not([hidden]) img')!;
    const image = lightbox.querySelector('img')!;
    image.src = source.src; image.alt = source.alt; lightbox.querySelector('p')!.textContent = source.alt;
    lightbox.showModal();
  });
  lightbox.querySelector('button')!.addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', event => { if (event.target === lightbox) lightbox.close(); });
  root.querySelector<HTMLInputElement>('.install-faq-search input')!.addEventListener('input', event => {
    const query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase();
    let count = 0;
    root.querySelectorAll<HTMLDetailsElement>('.install-faq-list details').forEach(item => { item.hidden = !item.textContent?.toLocaleLowerCase().includes(query); if (!item.hidden) count++; });
    root.querySelector<HTMLElement>('[data-faq-empty]')!.hidden = count > 0;
  });
  root.querySelector('[data-copy-link]')!.addEventListener('click', async () => {
    const status = root.querySelector<HTMLElement>('.install-copy-status')!;
    try { await navigator.clipboard.writeText(siteUrl); status.textContent = '설치 주소를 복사했어요.'; }
    catch { status.textContent = `이 주소를 다른 기기에서 열어주세요: ${siteUrl}`; }
  });
  initInstallDemo(root);

  const guide = root.querySelector<HTMLElement>('#install-manual')!;
  // Android is distributed as an APK; suppress the browser's unrelated PWA prompt.
  window.addEventListener('beforeinstallprompt', event => event.preventDefault());
  root.querySelectorAll<HTMLAnchorElement>('[data-download]').forEach(link => link.addEventListener('click', event => {
    if (!navigator.onLine) {
      event.preventDefault(); guide.textContent = 'APK 다운로드에는 인터넷 연결이 필요해요. 연결한 뒤 다시 눌러 주세요.';
      guide.classList.add('install-manual-emphasis'); guide.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'center' });
    }
  }));
  // Metadata is optional; the stable download works even offline or when GitHub rate-limits.
  void fetch('https://api.github.com/repos/znh0o/mynotes/releases/latest', { signal: AbortSignal.timeout(6000) }).then(async response => {
    if (!response.ok) return;
    const release = await response.json();
    const apk = release.assets?.find((item: { name?: string }) => /^Notelin-.*\.apk$/.test(item.name || ''));
    if (typeof release.tag_name === 'string' && /^v\d+\.\d+\.\d+$/.test(release.tag_name)) root.querySelector<HTMLElement>('[data-release-version]')!.textContent = release.tag_name;
    if (typeof apk?.size === 'number' && apk.size > 0) root.querySelector<HTMLElement>('[data-release-size]')!.textContent = `${(apk.size / 1_000_000).toFixed(1)} MB · Android 8+`;
  }).catch(() => {});
}
