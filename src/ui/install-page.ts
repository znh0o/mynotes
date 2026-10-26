import { registerSW } from 'virtual:pwa-register';
import { initInstallExperience } from './install-experience';

const paths: Record<string, string> = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
  pen: '<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/>',
  marker: '<path d="m5 13 8-10 7 6-8 10-7-6Zm0 0-2 5 5 3 4-2M3 22h8"/>',
  eraser: '<path d="m14 3 7 7-11 11H5l-4-4L14 3Zm-9 10 8 7M10 21h12"/>',
  undo: '<path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12h-3"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v16c3-1 6-1 10 1 4-2 7-2 10-1V4c-2-1-6-2-10 1Zm0 0v16"/>',
  pdf: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8M8 16h6"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  offline: '<path d="M3 3l18 18M8.5 8.5A11 11 0 0 1 21 9M3 9l2-1m2 5a7 7 0 0 1 6-2M10 17a3 3 0 0 1 4 0"/><circle cx="12" cy="21" r=".5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;

/** Marketing is independent of the editor and never reads or opens the notes database. */
export function renderInstallPage(root: HTMLElement) {
  document.title = 'Notelin · 손으로 쓰는 나의 모든 것';
  const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;
  const logo = asset('notelin-wordmark-transparent.png');
  const editor = asset('notelin-editor-preview.webp');
  const pdf = asset('notelin-pdf-preview.webp');
  const library = asset('notelin-library-preview.webp');
  const apk = 'https://github.com/znh0o/mynotes/releases/latest/download/Notelin.apk';
  const faqs = [
    ['어떤 기기에서 사용할 수 있나요?', 'Android 8 이상에서는 APK를 설치할 수 있어요. iPhone·iPad·Mac에서는 Safari로 이 사이트를 열고 웹 앱(PWA)을 추가해 주세요. S펜 필기와 넓은 화면의 구성은 갤럭시 탭에 맞춰져 있어요.'],
    ['iPhone이나 iPad에는 어떻게 설치하나요?', 'Safari에서 이 사이트를 열고 공유 버튼 → ‘홈 화면에 추가’ → ‘추가’를 선택하세요. ‘웹 앱으로 열기’ 항목이 있다면 켜 주세요. 홈 화면의 Notelin 아이콘으로 실행하면 서재가 열려요. 메뉴가 보이지 않으면 Safari에서 다시 열어 주세요.'],
    ['다운로드한 APK는 어디에서 찾나요?', '사용한 브라우저의 다운로드 목록이나 ‘내 파일 → 다운로드’에서 Notelin.apk를 열어 주세요. 설치 허용 화면이 나오면 해당 브라우저에 설치를 허용한 뒤 다시 파일을 열면 돼요.'],
    ['인터넷 없이도 사용할 수 있나요?', 'Android 앱은 설치 후 인터넷 없이 노트를 작성하고 가져온 PDF를 볼 수 있어요. PWA는 처음 연결해 실행하고 필요한 자료를 불러온 뒤 오프라인으로 사용해 주세요. 앱 다운로드와 업데이트 확인에는 인터넷이 필요해요.'],
    ['노트는 어디에 저장되나요?', '노트는 사용 중인 앱 또는 브라우저의 기기 저장 공간에 저장돼요. 자동 클라우드 동기화는 제공하지 않아요. 소중한 기록은 앱 설정의 전체 백업으로 파일을 따로 보관할 수 있어요.'],
    ['PDF를 Notelin에서 바로 열 수 있나요?', 'Android APK에서는 ‘내 파일 → PDF 길게 누르기 → 연결 프로그램 → Notelin’을 선택하세요. ‘항상’을 선택할 수 있는 환경에서는 기본 PDF 앱으로 지정할 수 있어요. 파일은 Notelin에 노트 사본으로 가져와요.'],
    ['설치한 앱은 어떻게 업데이트하나요?', 'Android 앱의 ‘설정 → 업데이트 확인 → 다운로드 후 설치’를 사용하세요. 마지막 설치 확인은 Android 시스템에서 진행해요. PWA는 인터넷에 연결한 상태에서 앱에 표시되는 업데이트 안내를 따라 주세요.'],
  ];
  root.innerHTML = `<div class="install-page">
    <a class="install-skip" href="#features">본문으로 건너뛰기</a>
    <header class="install-header" id="top">
      <a class="install-brand" href="#top" aria-label="Notelin 처음으로"><img src="${logo}" alt="Notelin" width="148" height="52" /></a>
      <nav class="install-nav" id="install-nav" aria-label="설치 페이지 탐색"><a href="#features">앱 살펴보기</a><a href="#try-it">직접 써보기</a><a href="#install-guide">설치 방법</a><a href="#help">도움말</a></nav>
      <div class="install-header-actions">
        <div class="install-appearance"><button class="install-appearance-toggle" type="button" aria-label="화면 모드" aria-expanded="false" aria-controls="install-appearance-menu"><span class="install-theme-sun">${icon('sun')}</span><span class="install-theme-moon">${icon('moon')}</span></button><div class="install-appearance-menu" id="install-appearance-menu" role="group" aria-label="화면 모드 선택" hidden><button type="button" data-appearance="light">밝게</button><button type="button" data-appearance="dark">어둡게</button><button type="button" data-appearance="system">기기 설정</button></div></div>
        <a class="install-header-link" href="${apk}" data-download data-cta="header"><span>다운로드</span>${icon('download')}</a>
        <button class="install-menu-toggle" type="button" aria-label="메뉴 열기" aria-expanded="false" aria-controls="install-nav">${icon('menu')}</button>
      </div>
    </header>
    <main>
      <section class="install-hero" aria-labelledby="install-title"><div class="install-hero-inner">
        <div class="install-hero-copy"><h1 id="install-title">손으로 쓰는<br />나의 <em>모든 것.</em></h1><p class="install-description">자료 위에 바로 쓰고, 나만의 노트로 정리하세요.<br />익숙한 필기를 Notelin에서.</p><div class="install-hero-actions"><a class="install-cta" id="install-app" href="${apk}" data-download data-cta="hero"><span>Android 앱 다운로드</span>${icon('download')}</a><a class="install-text-link" href="#try-it">먼저 써볼까요? ${icon('arrow')}</a></div><p class="install-caption" data-platform-caption>Android 8 이상 · Galaxy Tab &amp; Phone</p></div>
        <div class="install-hero-art" aria-label="현재 Notelin 앱의 필기 미리보기"><div class="install-hero-tablet"><img src="${editor}" alt="현재 Notelin UI로 펼친 통합과학1 손글씨 노트" width="1440" height="900" fetchpriority="high" /></div></div></div></section>

      <section class="install-product" id="features" aria-labelledby="features-title"><div class="install-section-heading" data-reveal><h2 id="features-title">읽고, 쓰고, 정리하고.<br />공부의 흐름은 그대로.</h2><p>노트 한 권을 펼치는 일부터<br />여러 장의 자료를 연결하는 일까지.</p></div>
        <div class="install-product-showcase" data-reveal><div class="install-preview-tabs" role="tablist" aria-label="앱 미리보기"><button type="button" id="preview-write" role="tab" aria-selected="true" aria-controls="preview-write-panel" tabindex="0">${icon('pen')}필기하는 순간</button><button type="button" id="preview-pdf" role="tab" aria-selected="false" aria-controls="preview-pdf-panel" tabindex="-1">${icon('pdf')}PDF 공부</button><button type="button" id="preview-library" role="tab" aria-selected="false" aria-controls="preview-library-panel" tabindex="-1">${icon('book')}나만의 서재</button></div>
        <div class="install-device"><div id="preview-write-panel" role="tabpanel" aria-labelledby="preview-write" tabindex="0"><img src="${editor}" width="1440" height="900" loading="lazy" alt="현재 Notelin 필기 화면. 사용자가 제공한 통합과학 손글씨 노트를 펼친 모습" /><div class="install-preview-description"><strong>S펜에 맞춘 필기</strong><p>나의 펜과 색으로, 익숙한 손글씨 그대로.</p></div></div><div id="preview-pdf-panel" role="tabpanel" aria-labelledby="preview-pdf" tabindex="0" hidden><img src="${pdf}" width="1440" height="900" loading="lazy" alt="현재 Notelin의 PDF 두 페이지 보기. 형광펜과 메모로 정리한 광합성 자료" /><div class="install-preview-description"><strong>PDF 위에 바로 기록</strong><p>자료를 나란히 펼치고, 중요한 곳에 표시하세요.</p></div></div><div id="preview-library-panel" role="tabpanel" aria-labelledby="preview-library" tabindex="0" hidden><img src="${library}" width="1440" height="1000" loading="lazy" alt="현재 Notelin 서재 화면. 노트와 PDF를 과목별로 정리한 모습" /><div class="install-preview-description"><strong>다시 찾기 쉬운 나의 서재</strong><p>과목별 폴더와 즐겨찾기로 필요한 노트에 가깝게.</p></div></div><button class="install-expand" type="button" aria-label="미리보기 크게 보기">${icon('expand')}</button></div></div>
      </section>

      <section class="install-try" id="try-it" aria-labelledby="try-title"><div class="install-try-inner"><div class="install-try-copy" data-reveal><h2 id="try-title">일단, 한 줄<br />그어볼까요?</h2><p>펜을 고르고 색을 바꿔보세요.<br />설치하기 전 가볍게 써보는 작은 종이예요.</p><p class="install-demo-note">웹 필기 체험 · 이곳의 필기는 저장되지 않아요.</p></div>
      <div class="install-playground" data-reveal><div class="install-demo-toolbar"><div class="install-demo-tools" role="group" aria-label="체험 필기 도구"><button type="button" data-demo-tool="pen" aria-label="체험 볼펜" aria-pressed="true">${icon('pen')}</button><button type="button" data-demo-tool="marker" aria-label="체험 형광펜" aria-pressed="false">${icon('marker')}</button><button type="button" data-demo-tool="eraser" aria-label="체험 지우개" aria-pressed="false">${icon('eraser')}</button></div><span class="install-demo-divider"></span><div class="install-demo-colors" role="group" aria-label="체험 펜 색상">${[['#315ed0','파랑'],['#243244','검정'],['#bc5663','빨강'],['#438571','초록']].map(([color,name],i)=>`<button type="button" style="--swatch:${color}" data-demo-color="${color}" aria-label="체험 ${name}" aria-pressed="${i===0}"></button>`).join('')}</div><div class="install-demo-actions"><button type="button" data-demo-undo aria-label="체험 실행 취소" disabled>${icon('undo')}</button><button type="button" data-demo-clear aria-label="체험 전체 지우기">${icon('trash')}</button></div></div><div class="install-demo-paper"><svg class="install-demo-surface" viewBox="0 0 720 430" aria-label="선을 그려보는 필기 체험 종이" role="img"><defs><pattern id="demo-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#b8c3d2" opacity=".45"/></pattern></defs><rect width="720" height="430" fill="url(#demo-dots)"/><g data-demo-ink></g></svg><div class="install-demo-hint" aria-hidden="true">여기에 자유롭게 써보세요.</div><div class="install-demo-foot"><label for="install-demo-width">굵기</label><input id="install-demo-width" type="range" min="1" max="8" step=".5" value="3"/><output for="install-demo-width">3.0</output><span data-demo-status role="status" aria-live="polite">펜으로 선을 그려보세요.</span></div></div></div></div></section>

      <section class="install-details" aria-labelledby="details-title"><div class="install-section-heading" data-reveal><h2 id="details-title">자주 쓰는 것일수록,<br />내 방식에 맞게.</h2><p>필기하는 동안 필요한 도구를<br />가까운 곳에 모아두었어요.</p></div><div class="install-essentials" data-reveal>${[['pdf','PDF 가져오기·내보내기','자료 위에 필기하고, 기록을 담아 PDF로 저장해요.'],['layers','필요한 만큼 편집','글 입력, 이미지, 도형과 레이어로 내용을 정리해요.'],['offline','기기에 자동 저장','인터넷 없이도 기록하고, 전체 백업으로 보관해요.']].map(([i,title,copy])=>`<article>${icon(i)}<div><h3>${title}</h3><p>${copy}</p></div></article>`).join('')}</div></section>

      <section class="install-guide" id="install-guide" aria-labelledby="install-guide-title"><div class="install-guide-inner"><div class="install-guide-intro" data-reveal><h2 id="install-guide-title">설치하고<br />바로 시작하세요.</h2><p data-guide-description>Android 기기에 Notelin을 설치하세요.</p><a class="install-cta install-cta-light" href="${apk}" data-download data-cta="guide"><span>APK 다운로드</span>${icon('download')}</a><div class="install-release" data-release><span data-release-version>Android 앱</span><span data-release-size>Android 8 이상</span><a href="https://github.com/znh0o/mynotes/releases/latest" target="_blank" rel="noopener noreferrer">릴리스 보기 ↗</a></div></div><div class="install-guide-details" data-reveal><div class="install-platforms" role="group" aria-label="설치할 기기 선택"><button type="button" data-platform="android" aria-pressed="true">Android</button><button type="button" data-platform="ios" aria-pressed="false">iPhone · iPad</button><button type="button" data-platform="mac" aria-pressed="false">Mac</button></div><h3 data-guide-heading>Notelin 설치 방법</h3><ol data-guide-steps></ol><p class="install-manual" id="install-manual" role="status" aria-live="polite"></p></div><div class="install-send"><span>다른 기기에서 설치하려면 이 페이지를 열어주세요.</span><button type="button" data-copy-link>${icon('copy')}설치 주소 복사</button><span class="install-copy-status" role="status" aria-live="polite"></span></div></div></section>

      <section class="install-help" id="help" aria-labelledby="help-title"><div class="install-help-heading" data-reveal><h2 id="help-title">궁금한 점이 있나요?</h2><label class="install-faq-search">${icon('search')}<input type="search" placeholder="설치, PDF, 저장…" aria-label="도움말 검색" /></label><p data-faq-empty hidden>일치하는 도움말이 없어요. 다른 단어로 찾아보세요.</p></div><div class="install-faq-list" data-reveal>${faqs.map(([q,a])=>`<details><summary>${q}<span aria-hidden="true">+</span></summary><p>${a}</p></details>`).join('')}</div></section>
    </main>
    <footer class="install-footer"><div><a href="#top" aria-label="Notelin 처음으로"><img src="${logo}" alt="Notelin" width="140" height="49" /></a><p>나의 기록, 나의 Notelin.</p></div><nav aria-label="하단 탐색"><a href="#features">앱 살펴보기</a><a href="#help">도움말</a><a href="https://github.com/znh0o/mynotes" target="_blank" rel="noopener noreferrer">GitHub ↗</a></nav><div class="install-footer-bottom"><span>© ${new Date().getFullYear()} Notelin</span><a href="#top">맨 위로 ↑</a></div></footer>
    <dialog class="install-lightbox" aria-label="앱 화면 크게 보기"><div class="install-lightbox-bar"><span>Notelin · 앱 미리보기</span><button type="button" aria-label="미리보기 닫기">${icon('close')}</button></div><img alt=""/><p></p></dialog>
  </div>`;
  initInstallExperience(root);
  if ('serviceWorker' in navigator) {
    // No open notes on the landing route, so a new version can activate immediately.
    const applyUpdate = registerSW({ immediate: true, onNeedRefresh() { void applyUpdate(true); } });
  }
}
