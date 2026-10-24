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

// Fullscreen temporarily changes the display-mode media query too. The route
// is chosen at launch; reloading here would close an open note on fullscreen.

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
    <header class="install-header"><img src="${logo}" alt="Notelin" width="158" height="60" /><span>Galaxy Tab을 위한 노트</span></header>
    <main class="install-main">
      <section class="install-copy" aria-labelledby="install-title">
        <div class="install-kicker"><span class="install-kicker-line"></span>S펜 필기 앱 · Notelin</div>
        <h1 id="install-title">필기와 자료가<br><em>한 권에.</em></h1>
        <p class="install-description">떠오른 생각은 S펜으로 적고, 공부할 PDF에는 바로 표시하세요. 노트와 페이지를 정리하며 기록을 이어가세요.</p>
        <button class="install-cta" type="button" id="install-app">Notelin 설치하기 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <p class="install-caption">설치 후 홈 화면의 Notelin 아이콘에서 시작하세요.</p>
        <p class="install-manual" id="install-manual" role="status" aria-live="polite">${manualInstallGuide()}</p>
      </section>
      <div class="install-visual" aria-hidden="true">
        <div class="install-preview-label">Notelin 미리보기 <span>S펜 필기 · PDF 메모</span></div>
        <div class="install-tablet"><div class="install-tablet-camera"></div><div class="install-tablet-screen">
          <div class="preview-top"><strong>개념 정리</strong><span>생명과학 · 3장</span><i></i><i></i><i></i></div>
          <div class="preview-tools"><span class="preview-tool-active">✎</span><span>▰</span><span>⌁</span><b></b><i></i><i></i><i></i></div>
          <div class="preview-workspace"><div class="preview-pages"><span></span><span></span><span></span></div>
            <div class="preview-paper"><small>03&nbsp; / &nbsp;생명과학</small><h2>세포의 구조</h2><div class="preview-rule"></div><p>세포막은 세포의 안과 밖을 구분하고<br>물질의 이동을 조절한다.</p><div class="preview-marker"></div><div class="preview-diagram"><span></span><span></span><span></span></div><div class="preview-lines"></div></div>
            <div class="preview-paper preview-second"><small>04&nbsp; / &nbsp;필기</small><h2>오늘의 정리</h2><div class="preview-rule"></div><div class="preview-lines"></div><div class="preview-note-line"></div></div>
          </div>
        </div></div>
        <div class="install-visual-caption">S펜 필기와 PDF 자료를 같은 노트에서</div>
      </div>
    </main>
    <section class="install-benefits" aria-label="Notelin 주요 기능"><div><span>01</span><strong>S펜으로 쓰고</strong><p>볼펜·만년필·연필을 골라 자연스럽게 기록하세요.</p></div><div><span>02</span><strong>PDF에 표시하고</strong><p>자료를 불러와 그 위에 필기한 뒤 다시 내보내세요.</p></div><div><span>03</span><strong>노트로 정리하세요</strong><p>페이지와 서재에서 기록을 이어서 찾을 수 있어요.</p></div></section>
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
