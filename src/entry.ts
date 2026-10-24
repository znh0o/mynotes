import './style.css';
import './theme.css';
import './landing.css';
import { registerSW } from 'virtual:pwa-register';
import { installFastTaps } from './ui/tool-taps';
import { initInstallExperience } from './ui/install-experience';

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
// Fullscreen temporarily changes display-mode. Choose the route at launch only;
// reloading on a media query change would close the user's open note.
function manualInstallGuide() {
  const ua = navigator.userAgent;
  if (/SamsungBrowser\//.test(ua)) return '삼성 인터넷의 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택한 뒤, 홈 화면이나 앱 목록의 Notelin 아이콘을 여세요.';
  if (/iPad|iPhone|iPod/.test(ua)) return 'Safari의 공유 버튼을 누르고 “홈 화면에 추가”를 선택한 뒤, 홈 화면의 Notelin 아이콘을 여세요.';
  return '브라우저 주소창의 설치 아이콘이나 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택한 뒤, 설치된 Notelin 아이콘을 여세요.';
}
function showInstallPage() {
  document.title = 'Notelin · 생각이 쌓이는 한 권의 노트';
  const logo = `${import.meta.env.BASE_URL}notelin-wordmark-lockup.png`;
  const editorPreview = `${import.meta.env.BASE_URL}notelin-editor-preview.webp`;
  const libraryPreview = `${import.meta.env.BASE_URL}notelin-library-preview.webp`;
  const pdfPreview = `${import.meta.env.BASE_URL}notelin-pdf-preview.webp`;
  const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  root.innerHTML = `<div class="install-page">
    <header class="install-header" id="top">
      <a class="install-brand" href="#top" aria-label="Notelin 처음으로"><img src="${logo}" alt="Notelin" width="154" height="58" /></a>
      <nav class="install-nav" aria-label="설치 페이지 탐색"><a href="#features">주요 기능</a><a href="#install-guide">설치 방법</a></nav>
      <button class="install-header-link" type="button" data-install>앱 설치 <span aria-hidden="true">↗</span></button>
    </header>
    <main>
      <section class="install-hero" aria-labelledby="install-title">
        <div class="install-hero-copy">
          <p class="install-overline"><span></span> YOUR NEXT NOTE STARTS HERE</p>
          <h1 id="install-title">생각이 쌓이는<br /><em>한 권의 노트.<svg class="install-ink-line" viewBox="0 0 480 24" fill="none" aria-hidden="true"><path d="M6 16C130 3 297 3 474 12" pathLength="1" /></svg></em></h1>
          <p class="install-description">떠오른 생각부터 오래 들여다볼 공부까지.<br />쓰고, 펼치고, 간직하는 나만의 공간, Notelin.</p>
          <div class="install-hero-actions"><button class="install-cta" type="button" id="install-app" data-install>Notelin 설치하기 ${arrow}</button><a href="#features">앱 살펴보기 <span aria-hidden="true">↓</span></a></div>
          <p class="install-caption">Galaxy Tab · S펜 · 설치형 웹 앱</p>
        </div>
        <figure class="install-product-showcase">
          <div class="install-preview-tabs" role="tablist" aria-label="앱 미리보기"><button type="button" id="preview-write" role="tab" aria-selected="true" aria-controls="preview-write-panel" tabindex="0">필기하는 순간</button><button type="button" id="preview-pdf" role="tab" aria-selected="false" aria-controls="preview-pdf-panel" tabindex="-1">PDF 공부</button><button type="button" id="preview-library" role="tab" aria-selected="false" aria-controls="preview-library-panel" tabindex="-1">나만의 서재</button></div>
          <div class="install-showcase-backdrop"><div class="install-device"><div id="preview-write-panel" role="tabpanel" aria-labelledby="preview-write" tabindex="0"><img src="${editorPreview}" width="1440" height="900" loading="lazy" alt="제공받은 통합과학 필기를 Notelin에서 펼친 화면. 우주와 원소의 생성을 손글씨와 형광펜으로 정리한 노트입니다." /></div><div id="preview-pdf-panel" role="tabpanel" aria-labelledby="preview-pdf" tabindex="0" hidden><img src="${pdfPreview}" width="1440" height="900" loading="lazy" alt="실제 Notelin의 두 페이지 PDF. 형광펜과 한글 메모로 광합성 자료를 정리한 화면" /></div><div id="preview-library-panel" role="tabpanel" aria-labelledby="preview-library" tabindex="0" hidden><img src="${libraryPreview}" width="1440" height="1000" alt="실제 Notelin 앱의 서재. 과목별 노트를 표지와 함께 모아 둔 화면입니다." /></div></div><span class="install-stylus" aria-hidden="true"></span></div>
          <figcaption><span>MADE FOR YOUR EVERYDAY NOTES</span><span>Notelin에서 펼친 필기 · 이미지로 가져온 노트</span></figcaption>
        </figure>
      </section>
      <section class="install-capabilities" id="features" aria-label="Notelin 주요 기능">
        <div data-reveal><svg class="install-feature-art" viewBox="0 0 160 72" fill="none" aria-hidden="true"><path class="install-drawn" pathLength="1" d="M15 51C42 5 60 16 44 45S75 55 88 34 113 30 104 45 129 50 145 34" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span>01 / WRITE</span><strong>S펜에 맞춘 필기</strong><p>볼펜·만년필·연필을 골라 쓰고, 노트마다 펜 설정을 기억해요.</p></div>
        <div data-reveal><svg class="install-feature-art" viewBox="0 0 160 72" fill="none" aria-hidden="true"><rect x="34" y="4" width="91" height="64" rx="5" stroke="currentColor" stroke-opacity=".3"/><path d="M48 22H108M48 35H108M48 48H85" stroke="currentColor" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/><path class="install-drawn" pathLength="1" d="M48 35H106" stroke="#e5bd57" stroke-width="11" stroke-opacity=".55"/></svg><span>02 / ANNOTATE</span><strong>PDF 위에 바로 기록</strong><p>자료를 가져와 표시한 뒤 필기를 담아 PDF로 내보내요.</p></div>
        <div data-reveal><svg class="install-feature-art" viewBox="0 0 160 72" fill="none" aria-hidden="true"><path d="M78 15Q52 3 22 12V61Q53 53 78 64ZM82 15Q108 3 138 12V61Q107 53 82 64Z" stroke="currentColor" stroke-width="1.5" stroke-opacity=".6"/><path class="install-drawn" pathLength="1" d="M35 27L63 29M35 39L63 41M97 29L125 27M97 41L125 39" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity=".4"/></svg><span>03 / EXPAND</span><strong>나란히 펼친 두 페이지</strong><p>양쪽 페이지를 보면서 어디에든 바로 필기할 수 있어요.</p></div>
      </section>
      <section class="install-workflow" aria-labelledby="workflow-title">
        <div class="install-section-heading" data-reveal><p>A PLACE FOR EVERY PAGE</p><h2 id="workflow-title">매일의 기록이<br />나만의 서재가 되도록.</h2><span>과목별 노트와 PDF를 한곳에 모으고,<br />필요한 페이지를 다시 펼쳐 보세요.</span></div>
        <div class="install-workflow-grid"><div class="install-library-shot" data-reveal><div class="install-window-bar" aria-hidden="true"><i></i><i></i><i></i><span>나의 서재</span></div><img src="${libraryPreview}" width="1440" height="1000" loading="lazy" alt="실제 Notelin 앱의 나의 서재 화면. 여러 노트가 표지와 함께 정리되어 있습니다." /></div><div class="install-workflow-copy"><div class="install-workflow-step" data-reveal><span>01</span><div><h3>나에게 맞는 필기 도구</h3><p>자주 쓰는 펜의 색과 굵기를 저장하고, 다음 필기에서도 그대로 이어가세요.</p></div></div><div class="install-workflow-step" data-reveal><span>02</span><div><h3>읽던 자료 위에 바로</h3><p>PDF를 가져와 중요한 문장을 표시하고, 여백에 떠오른 생각을 적어 두세요.</p></div></div><div class="install-workflow-step" data-reveal><span>03</span><div><h3>내 기기에 차곡차곡</h3><p>노트는 이 기기에 자동 저장돼요. 소중한 기록은 설정에서 백업할 수 있어요.</p></div></div></div></div>
      </section>
      <section class="install-guide" id="install-guide" aria-labelledby="install-guide-title"><div class="install-guide-intro" data-reveal><p>READY FOR YOUR FIRST PAGE?</p><h2 id="install-guide-title">이제, 첫 페이지를<br />펼쳐 볼까요.</h2><span>홈 화면에 Notelin을 추가하고<br />언제든 나만의 서재로 돌아오세요.</span><button type="button" class="install-cta install-cta-light" data-install>지금 설치하기 ${arrow}</button></div><div class="install-guide-details" data-reveal><h3>Notelin을 시작하는 방법</h3><ol><li><span>01</span><div><strong>설치 버튼 누르기</strong><p>이 페이지의 설치 버튼을 누르세요.</p></div></li><li><span>02</span><div><strong>앱으로 추가하기</strong><p>브라우저의 설치 창을 완료하세요.</p></div></li><li><span>03</span><div><strong>아이콘에서 열기</strong><p>홈 화면이나 앱 목록의 Notelin을 실행하세요.</p></div></li></ol></div><p class="install-manual" id="install-manual" role="status" aria-live="polite">${manualInstallGuide()}</p></section>
    </main>
    <footer class="install-footer"><img src="${logo}" alt="Notelin" width="124" height="46" /><span>생각을 쓰고, 오래 간직하는 공간.</span><a href="#top">맨 위로 ↑</a></footer>
  </div>`;
  initInstallExperience(root);
  let deferredPrompt: InstallPrompt | undefined;
  const guide = root.querySelector<HTMLElement>('#install-manual')!;
  const showGuide = () => {
    guide.classList.add('install-manual-emphasis');
    guide.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event as InstallPrompt;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    guide.textContent = '설치가 완료됐어요. 홈 화면이나 앱 목록의 Notelin 아이콘에서 열어 주세요.';
  });
  root.querySelectorAll<HTMLButtonElement>('[data-install]').forEach(button => button.addEventListener('click', async () => {
    if (!deferredPrompt) { showGuide(); return; }
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
    showGuide();
  }));
  if ('serviceWorker' in navigator) {
    // The install page has no open notes to save, so activate new releases immediately.
    const applyUpdate = registerSW({ immediate: true, onNeedRefresh() { void applyUpdate(true); } });
  }
}
