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
  const editorPreview = `${import.meta.env.BASE_URL}notelin-editor-preview.webp`;
  const libraryPreview = `${import.meta.env.BASE_URL}notelin-library-preview.webp`;
  root.innerHTML = `<div class="install-page">
    <header class="install-header" id="top">
      <a class="install-brand" href="#top" aria-label="Notelin 처음으로"><img src="${logo}" alt="Notelin" width="154" height="58" /></a>
      <nav class="install-nav" aria-label="설치 페이지 탐색"><a href="#features">주요 기능</a><a href="#install-guide">설치 방법</a></nav>
      <a class="install-header-link" href="#install-guide">Galaxy Tab에서 시작하기 <span aria-hidden="true">↗</span></a>
    </header>
    <main>
      <section class="install-hero" aria-labelledby="install-title">
        <div class="install-hero-copy">
          <p class="install-overline"><span></span> GALAXY TAB을 위한 필기 앱</p>
          <h1 id="install-title">생각이 쌓이는<br /><em>한 권의 노트.</em></h1>
          <p class="install-description">S펜으로 생각을 적고, PDF에 바로 표시하세요. 펼쳐 쓰고 정리하는 모든 순간을 Notelin 한곳에 담았습니다.</p>
          <div class="install-hero-actions"><button class="install-cta" type="button" id="install-app">Notelin 설치하기 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg></button><a href="#features">앱 살펴보기 <span aria-hidden="true">↓</span></a></div>
          <p class="install-caption">홈 화면에 설치한 뒤 앱 아이콘에서 노트를 열 수 있어요.</p>
        </div>
        <figure class="install-product-showcase">
          <div class="install-showcase-backdrop"><div class="install-device"><img src="${editorPreview}" width="1440" height="900" alt="실제 Notelin 앱의 S펜 필기 화면. 페이지 목록과 필기 도구, 세포 구조를 정리한 노트가 보입니다." /></div></div>
          <figcaption>실제 앱 화면 <span>·</span> 예시 노트</figcaption>
        </figure>
      </section>
      <section class="install-capabilities" aria-label="Notelin 주요 기능">
        <div><span>01</span><strong>S펜에 맞춘 필기</strong><p>볼펜·만년필·연필을 골라 쓰고, 노트마다 펜 설정을 기억해요.</p></div>
        <div><span>02</span><strong>PDF 위에 바로 기록</strong><p>자료를 가져와 표시한 뒤 필기를 담아 PDF로 내보내요.</p></div>
        <div><span>03</span><strong>나란히 펼친 두 페이지</strong><p>양쪽 페이지를 보면서 어디에든 바로 필기할 수 있어요.</p></div>
      </section>
      <section class="install-workflow" id="features" aria-labelledby="workflow-title">
        <div class="install-section-heading"><p>WRITE. ORGANIZE. RETURN.</p><h2 id="workflow-title">필기가 쌓일수록<br />서재는 더 나다워집니다.</h2><span>과목별 노트와 PDF를 한곳에 모으고, 필요한 페이지를 다시 펼쳐 보세요.</span></div>
        <div class="install-workflow-grid"><div class="install-library-shot"><img src="${libraryPreview}" width="1440" height="1000" loading="lazy" alt="실제 Notelin 앱의 나의 서재 화면. 여러 노트가 표지와 함께 정리되어 있습니다." /></div><div class="install-workflow-copy"><div class="install-workflow-step"><span>01 / WRITE</span><h3>손으로 쓰는 감각에 집중</h3><p>펜의 색과 굵기를 골라 쓰고, 지우개와 도형으로 내용을 다듬으세요.</p></div><div class="install-workflow-step"><span>02 / STUDY</span><h3>자료와 필기를 함께</h3><p>PDF를 페이지로 가져오면 읽던 자료 위에서 바로 생각을 이어갈 수 있어요.</p></div><div class="install-workflow-step"><span>03 / KEEP</span><h3>내 기기에 차곡차곡</h3><p>노트는 이 기기에 자동 저장돼요. 설정에서 백업 파일도 만들 수 있습니다.</p></div></div></div>
      </section>
      <section class="install-guide" id="install-guide" aria-labelledby="install-guide-title"><div class="install-guide-intro"><p>GET STARTED</p><h2 id="install-guide-title">Notelin을 시작하는 방법</h2><span>설치한 앱에서 서재가 열립니다. 브라우저에서는 설치 안내만 표시돼요.</span></div><ol><li><span>01</span><strong>설치 버튼 누르기</strong><p>위의 ‘Notelin 설치하기’를 누르세요.</p></li><li><span>02</span><strong>앱으로 추가하기</strong><p>브라우저의 설치 창을 완료하세요.</p></li><li><span>03</span><strong>아이콘에서 열기</strong><p>홈 화면이나 앱 목록의 Notelin을 실행하세요.</p></li></ol><p class="install-manual" id="install-manual" role="status" aria-live="polite">${manualInstallGuide()}</p></section>
    </main>
    <footer class="install-footer"><img src="${logo}" alt="Notelin" width="124" height="46" /><span>생각을 쓰고, 오래 간직하는 공간.</span><a href="#top">맨 위로 ↑</a></footer>
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
    if (!deferredPrompt) { guide.classList.add('install-manual-emphasis'); guide.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
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
    guide.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  if ('serviceWorker' in navigator) {
    // The install page has no open notes to save, so activate new releases immediately.
    const applyUpdate = registerSW({ immediate: true, onNeedRefresh() { void applyUpdate(true); } });
  }
}
