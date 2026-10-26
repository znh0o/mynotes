import { getAppearance, setAppearance, type Appearance } from './appearance';
import { initInstallDemo } from './install-demo';

type Platform = 'android' | 'ios' | 'mac';
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
const siteUrl = 'https://znh0o.github.io/mynotes/';
const apkUrl = 'https://github.com/znh0o/mynotes/releases/latest/download/Notelin.apk';

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

  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  let platform: Platform = ios ? 'ios' : /Macintosh|Mac OS X/.test(ua) ? 'mac' : 'android';
  let prompt: InstallPrompt | undefined;
  const guide = root.querySelector<HTMLElement>('#install-manual')!;
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event as InstallPrompt; });
  const instructions: Record<Platform, { caption: string; description: string; heading: string; manual: string; steps: [string, string][] }> = {
    android: {
      caption: 'Android 8 이상 · Galaxy Tab & Phone', description: 'Android 기기에 Notelin을 설치하세요.', heading: 'Notelin 설치 방법',
      manual: '설치 허용 안내가 표시되면 사용 중인 브라우저의 앱 설치를 허용해 주세요.',
      steps: [['APK 다운로드','다운로드 버튼을 눌러 설치 파일을 받으세요.'],['다운로드한 파일 열기','브라우저 다운로드 목록이나 ‘내 파일 → 다운로드’에서 Notelin.apk를 여세요.'],['설치 후 시작하기','설치 화면의 안내를 완료한 뒤 Notelin을 실행하세요.']],
    },
    ios: {
      caption: 'iPhone · iPad · Safari 웹 앱(PWA)', description: 'Safari에서 홈 화면에 웹 앱을 추가하세요.', heading: 'iPhone · iPad에 PWA 설치하기',
      manual: '채팅 앱 안의 브라우저에서는 메뉴가 보이지 않을 수 있어요. 주소를 복사해 Safari에서 열어주세요.',
      steps: [['Safari에서 열기','iPhone 또는 iPad의 Safari에서 이 페이지를 여세요.'],['공유 → 홈 화면에 추가','공유 버튼을 누르고 ‘홈 화면에 추가’를 선택하세요. ‘웹 앱으로 열기’ 항목이 있으면 켜 주세요.'],['추가한 아이콘으로 실행','‘추가’를 누른 뒤 홈 화면의 Notelin 아이콘을 열면 서재로 이어져요.']],
    },
    mac: {
      caption: 'Mac · Safari 웹 앱(PWA)', description: 'Safari에서 Dock에 Notelin 웹 앱을 추가하세요.', heading: 'Mac에 PWA 설치하기',
      manual: 'macOS Sonoma 14 이상 Safari에서는 ‘Dock에 추가’를 사용할 수 있어요. 지원되는 Chrome에서는 브라우저의 앱 설치 메뉴를 사용해 주세요.',
      steps: [['Safari에서 열기','Mac의 Safari에서 이 페이지를 여세요.'],['파일 → Dock에 추가','메뉴 막대의 ‘파일 → Dock에 추가’를 선택하세요. 공유 메뉴에서도 찾을 수 있어요.'],['추가한 앱으로 실행','이름을 Notelin으로 확인하고 ‘추가’를 누른 뒤 Dock에서 실행하세요.']],
    },
  };
  function selectPlatform(next: Platform) {
    platform = next; const info = instructions[next];
    root.querySelectorAll<HTMLButtonElement>('[data-platform]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.platform === platform)));
    root.querySelector<HTMLElement>('[data-platform-caption]')!.textContent = info.caption;
    root.querySelector<HTMLElement>('[data-guide-description]')!.textContent = info.description;
    root.querySelector<HTMLElement>('[data-guide-heading]')!.textContent = info.heading;
    root.querySelector<HTMLElement>('[data-guide-steps]')!.innerHTML = info.steps.map(([title,copy],i) => `<li><span>0${i+1}</span><div><strong>${title}</strong><p>${copy}</p></div></li>`).join('');
    guide.textContent = info.manual; guide.classList.remove('install-manual-emphasis');
    root.querySelector<HTMLElement>('[data-release]')!.hidden = next !== 'android';
    root.querySelectorAll<HTMLAnchorElement>('[data-download]').forEach(link => {
      link.href = platform === 'android' ? apkUrl : '#install-guide';
      if (platform === 'android') link.setAttribute('download', 'Notelin.apk'); else link.removeAttribute('download');
      const label = platform === 'android' ? { header: '다운로드', hero: 'Android 앱 다운로드', guide: 'APK 다운로드' }[link.dataset.cta!] : { header: 'PWA 설치', hero: 'PWA 설치하기', guide: 'PWA 설치 안내' }[link.dataset.cta!];
      link.querySelector('span')!.textContent = label || '앱 설치';
    });
  }
  root.querySelectorAll<HTMLButtonElement>('[data-platform]').forEach(button => button.addEventListener('click', () => selectPlatform(button.dataset.platform as Platform)));
  selectPlatform(platform);
  root.querySelectorAll<HTMLAnchorElement>('[data-download]').forEach(link => link.addEventListener('click', async event => {
    if (platform !== 'android') {
      event.preventDefault();
      if (platform === 'mac' && prompt) {
        try { const deferred = prompt; prompt = undefined; await deferred.prompt(); await deferred.userChoice; return; } catch { /* The manual guide remains available. */ }
      }
      guide.classList.add('install-manual-emphasis');
      root.querySelector<HTMLElement>('#install-guide')!.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      guide.tabIndex = -1; guide.focus({ preventScroll: true });
    } else if (!navigator.onLine) {
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
