import './style.css';
import './theme.css';
import './landing.css';
import { registerSW } from 'virtual:pwa-register';
import { installFastTaps } from './ui/tool-taps';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const root = document.querySelector<HTMLElement>('#app')!;
const standaloneMode = window.matchMedia('(display-mode: standalone)');
installFastTaps();

// Display mode chooses the UI only. It is not proof of installation or an auth boundary.
if (standaloneMode.matches) {
  void import('./main').catch(error => {
    console.error('Notelin failed to start', error);
    root.innerHTML = '<div class="boot-error"><h1>Notelin을 열지 못했어요.</h1><p>앱을 다시 실행해 주세요.</p></div>';
  });
} else {
  showInstallPage();
}

standaloneMode.addEventListener?.('change', () => location.reload());

function manualInstallGuide() {
  const ua = navigator.userAgent;
  if (/SamsungBrowser\//.test(ua)) return '삼성 인터넷의 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택한 뒤, 홈 화면이나 앱 목록의 Notelin 아이콘을 여세요.';
  if (/iPad|iPhone|iPod/.test(ua)) return 'Safari의 공유 버튼을 누르고 “홈 화면에 추가”를 선택한 뒤, 홈 화면의 Notelin 아이콘을 여세요.';
  return '브라우저 주소창의 설치 아이콘이나 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택한 뒤, 설치된 Notelin 아이콘을 여세요.';
}

function showInstallPage() {
  document.title = 'Notelin · 앱 설치';
  const logo = `${import.meta.env.BASE_URL}notelin-wordmark-lockup.png`;
  root.innerHTML = `<div class="install-page">
    <header class="install-header"><img src="${logo}" alt="Notelin" width="158" height="60" /></header>
    <main class="install-main">
      <section class="install-copy" aria-labelledby="install-title">
        <div class="install-kicker"><span class="install-kicker-line"></span>S펜을 위한 나만의 노트</div>
        <h1 id="install-title">생각이 머무는<br><em>가장 편안한 곳.</em></h1>
        <p class="install-description">종이처럼 자연스러운 필기, PDF 위의 메모, 페이지마다 이어지는 생각. Notelin을 설치하고 나만의 공간에서 기록하세요.</p>
        <button class="install-cta" type="button" id="install-app">Notelin 설치하기 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <p class="install-caption">설치 후 홈 화면의 Notelin 아이콘에서 노트를 열 수 있어요.</p>
        <p class="install-manual" id="install-manual" role="status" aria-live="polite">${manualInstallGuide()}</p>
      </section>
      <div class="install-visual" aria-hidden="true">
        <div class="install-orbit"></div>
        <div class="install-note-shadow"></div>
        <div class="install-note">
          <div class="install-note-header"><span></span><span></span><span></span></div>
          <div class="install-note-rule"></div>
          <svg class="install-ink" viewBox="0 0 500 250" fill="none"><path d="M34 128C72 77 91 70 108 86c22 22-24 96-5 110 18 14 54-36 79-78 14-24 25-35 35-27 12 10-24 79-12 85 15 8 49-35 71-63 17-21 32-23 38-8 5 13-14 47-5 50 13 5 38-20 58-40 12-12 25-13 33-2 11 15-10 39 1 45 8 5 30-4 64-28" stroke="#213d70" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><path d="M69 218c95 14 247 10 363-4" stroke="#648ff3" stroke-width="7" stroke-linecap="round" opacity=".75"/></svg>
          <div class="install-note-lines"><i></i><i></i><i></i></div>
        </div>
        <div class="install-stylus"></div>
      </div>
    </main>
  </div>`;
  let deferredPrompt: InstallPrompt | undefined;
  const button = root.querySelector<HTMLButtonElement>('#install-app')!;
  const guide = root.querySelector<HTMLElement>('#install-manual')!;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event as InstallPrompt;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    guide.textContent = '설치가 완료됐어요. 홈 화면이나 앱 목록의 Notelin 아이콘에서 열어 주세요.';
  });
  button.addEventListener('click', async () => {
    if (!deferredPrompt) { guide.classList.add('install-manual-emphasis'); return; }
    const prompt = deferredPrompt; deferredPrompt = undefined;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      guide.textContent = choice.outcome === 'accepted'
        ? /SamsungBrowser\//.test(navigator.userAgent)
          ? '설치가 끝나면 앱 목록의 Notelin 아이콘을 열어 주세요. “Failed installing”이 뜬다면 삼성 인터넷 메뉴에서 “앱 설치”를 다시 시도해 주세요.'
          : '설치가 끝나면 홈 화면이나 앱 목록의 Notelin 아이콘에서 열어 주세요.'
        : manualInstallGuide();
    } catch {
      guide.textContent = manualInstallGuide();
    }
    guide.classList.add('install-manual-emphasis');
  });
  if ('serviceWorker' in navigator) {
    // The install page has no open notes to save, so activate new releases immediately.
    const applyUpdate = registerSW({ immediate: true, onNeedRefresh() { void applyUpdate(true); } });
  }
}
