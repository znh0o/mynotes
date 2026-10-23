import './style.css';
import './theme.css';
import { registerSW } from 'virtual:pwa-register';
import { backup, db, initialize, restore } from './data/store';
import { EditorView } from './ui/editor';
import { LibraryView, type LibraryState } from './ui/library';
import { AppHistory, type AppRoute, type Direction } from './ui/history';
import { finishSlide, slidePreviousView } from './ui/transitions';
import { escape, icon, modal, pickFile, report, run, toast } from './ui/common';
import { checkForUpdate, applyWaitingUpdate } from './pwa/updates';
import { version as appVersion } from '../package.json';
import { installFastTaps } from './ui/tool-taps';
import { installAppZoomGuard } from './ui/app-zoom';

installFastTaps();
installAppZoomGuard();

const root = document.querySelector<HTMLElement>('#app')!;
let library: LibraryView | undefined, editor: EditorView | undefined;
const tabs: { id: string; title: string }[] = [];
let libraryState: LibraryState = { filter: 'all', query: '', sort: 'updated', list: false };
let libraryScroll = 0;
const navigation = new AppHistory(renderRoute, report, () => toast('서재에 있어요. 노트를 열어 계속 사용할 수 있어요.'));
let installPrompt: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | undefined;
let updateAvailable = false;
let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
let updateChecking = false;
let updateApplying = false;
let updateMessage = '버튼을 눌러 새 버전을 확인하세요.';
function refreshUpdateControls() {
  library?.setUpdateState(updateAvailable, updateApplying);
  const status = document.querySelector<HTMLElement>('#update-status');
  if (status) status.textContent = updateMessage;
  const check = document.querySelector<HTMLButtonElement>('[data-setting=check-update]');
  if (check) { check.disabled = updateChecking; check.textContent = updateChecking ? '확인 중…' : '업데이트 확인'; }
  const apply = document.querySelector<HTMLButtonElement>('[data-setting=apply-update]');
  if (apply) { apply.hidden = !updateAvailable; apply.disabled = updateApplying; }
}
async function applyUpdate() {
  if (updateApplying) return;
  updateApplying = true; refreshUpdateControls();
  try {
    await applyWaitingUpdate(serviceWorkerRegistration, async () => {
      await editor?.flush(); updateMessage = '저장했어요. 새 버전을 적용하고 있어요…'; refreshUpdateControls();
    });
  } finally { updateApplying = false; refreshUpdateControls(); }
}
registerSW({
  immediate: true,
  onNeedReload() { /* Manual activation below reloads only after saving. */ },
  onOfflineReady() { toast('오프라인 사용 준비가 완료됐어요.'); },
  onNeedRefresh() {
    updateAvailable = true; updateMessage = '새 버전이 준비됐어요. 필기를 저장한 뒤 적용할 수 있어요.';
    refreshUpdateControls(); toast('새 버전이 준비됐어요. 서재의 업데이트 버튼을 눌러 적용하세요.');
  },
  onRegisteredSW(_url, registration) {
    serviceWorkerRegistration = registration;
    if (registration?.waiting) updateAvailable = true;
    refreshUpdateControls();
  },
  onRegisterError(error) { console.error('Service Worker registration failed', error); toast('오프라인 설치를 준비하지 못했어요. 연결을 확인해 주세요.', true); }
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e as typeof installPrompt; });
window.addEventListener('appinstalled', () => { installPrompt = undefined; toast('MyNotes가 설치됐어요.'); });
window.addEventListener('offline', () => toast('오프라인이에요. 이 기기에서 계속 필기할 수 있어요.'));
let lastUpdateCheck = 0;
function probeUpdate() {
  if (document.hidden || !navigator.onLine || !serviceWorkerRegistration || Date.now() - lastUpdateCheck < 60000) return;
  lastUpdateCheck = Date.now(); void serviceWorkerRegistration.update().catch(() => {});
}
window.addEventListener('focus', probeUpdate); window.addEventListener('online', probeUpdate);
document.addEventListener('visibilitychange', probeUpdate);
setInterval(probeUpdate, 10 * 60 * 1000);

async function home() {
  if (editor) await navigation.goHome();
  else await library?.show();
}
async function open(id: string) {
  await navigation.navigate({ screen: 'note', id });
}
async function renderRoute(route: AppRoute, direction: Direction) {
  if (route.screen === 'library' && library && !editor) {
    library.setFilter(route.filter); libraryState = library.snapshot(); return;
  }
  const note = route.screen === 'note' ? await db.notes.get(route.id) : undefined;
  if (route.screen === 'note' && (!note || note.deleted)) throw new Error('노트를 찾을 수 없어요.');
  finishSlide(); const previous = root.firstElementChild, oldScroll = window.scrollY, wasEditor = !!editor;
  if (library) { libraryState = library.snapshot(); libraryScroll = oldScroll; library.destroy(); library = undefined; }
  if (editor) { await editor.flush(); editor.destroy(); editor = undefined; }
  if (route.screen === 'library') {
    const restoreScroll = libraryState.filter === route.filter ? libraryScroll : 0;
    libraryState = { ...libraryState, filter: route.filter };
    library = new LibraryView(root, open, settings, filter => navigation.navigate({ screen: 'library', filter }), libraryState, applyUpdate);
    await library.show(); refreshUpdateControls(); window.scrollTo(0, restoreScroll);
  } else {
    const existing = tabs.find(t => t.id === note!.id);
    if (existing) existing.title = note!.title; else tabs.push({ id: note!.id, title: note!.title });
    await db.notes.update(note!.id, { opened: Date.now() });
    editor = new EditorView(root, note!, tabs, open, home, closeTab, settings); await editor.start(); window.scrollTo(0, 0);
  }
  slidePreviousView(root, previous, wasEditor && route.screen === 'note' ? 'none' : direction, oldScroll);
}
async function closeTab(id: string) {
  const current = editor?.note.id; if (current === id) await editor?.flush();
  const index = tabs.findIndex(t => t.id === id); if (index !== -1) tabs.splice(index, 1);
  if (current === id) { if (tabs.length) await open(tabs[Math.min(index, tabs.length - 1)].id); else await home(); }
  else if (current) await renderRoute({ screen: 'note', id: current }, 'none');
}
function settings() {
  run(async () => {
    const persisted = false, usage = '사용량 확인 중';
    const standalone = matchMedia('(display-mode: standalone)').matches;
    const dialog = modal('나의 MyNotes', `<div class="settings-intro"><span class="brand-mark">${icon('PenLine', 25)}</span><div><h3>생각이 머무는 곳.</h3><p>MyNotes ${escape(appVersion)} · 내 기기에만 보관하는 노트</p></div></div><div class="settings-section"><h3>${icon('HardDrive', 18)} 저장 공간</h3><div class="storage-row"><span>이 기기에서 사용 중</span><strong>${usage}</strong></div><p class="muted">${persisted ? '브라우저 영구 저장이 허용되어 있어요.' : '브라우저 정리로 데이터가 지워질 수 있어요. 중요한 노트는 별도로 백업해 주세요.'}</p><button type="button" class="button secondary" data-setting="persist">${icon('ShieldCheck', 16)} 영구 저장 요청</button></div><div class="settings-section"><h3>${icon('Download', 18)} 백업 및 복원</h3><p class="muted">노트, 필기, PDF와 이미지를 하나의 파일에 담아요. 복원은 기존 노트를 유지하며 사본으로 추가합니다.</p><div class="settings-actions"><button class="button secondary" type="button" data-setting="backup">전체 백업</button><button class="button secondary" type="button" data-setting="restore">백업 파일 복원</button></div></div><div class="settings-section"><h3>${icon('BookOpen', 18)} 앱으로 사용하기</h3><p class="muted">${standalone ? '설치된 앱으로 사용하고 있어요.' : 'Chrome 또는 Samsung Internet 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택해 주세요. 첫 방문 시 온라인 연결이 필요합니다.'}</p>${!standalone ? '<button class="button primary" type="button" data-setting="install">MyNotes 설치</button>' : ''}</div><div class="settings-section"><h3>${icon('RefreshCw', 18)} 앱 업데이트</h3><p class="muted settings-update-status" id="update-status" role="status" aria-live="polite">${escape(updateMessage)}</p><div class="settings-actions"><button class="button secondary" type="button" data-setting="check-update">업데이트 확인</button><button class="button primary" type="button" data-setting="apply-update" hidden>저장 후 새 버전 적용</button></div></div><p class="muted settings-footnote">손글씨는 편집 가능한 획으로 저장됩니다. 손글씨 인식, 기기 간 동기화는 아직 지원하지 않습니다. 웹 팜 리젝션과 S펜 버튼 동작은 브라우저에 따라 다를 수 있습니다.</p>`, '완료', () => {});
    dialog.querySelector('footer [data-close]')?.remove();
    void Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]).then(([estimate, persisted]) => {
      if (!dialog.isConnected) return;
      dialog.querySelector('.storage-row strong')!.textContent = estimate?.usage ? `${(estimate.usage / 1024 / 1024).toFixed(1)} MB` : '사용량 확인 불가';
      dialog.querySelector('.settings-section p')!.textContent = persisted ? '브라우저 영구 저장이 허용되어 있어요.' : '브라우저 정리로 데이터가 지워질 수 있어요. 중요한 노트는 별도로 백업해 주세요.';
    }).catch(() => {});
    refreshUpdateControls();
    dialog.querySelectorAll<HTMLElement>('[data-setting]').forEach(el => el.addEventListener('click', () => run(async () => {
      const action = el.dataset.setting; el.setAttribute('disabled', '');
      try {
        if (action === 'backup') { await editor?.flush(); await backup(); toast('백업 파일을 만들었어요.'); }
        if (action === 'restore') { const file = await pickFile('.json,application/json'); if (file) { await editor?.flush(); await restore(file); toast('백업을 사본으로 복원했어요.'); dialog.close(); await home(); } }
        if (action === 'persist') { const allowed = await navigator.storage?.persist?.(); toast(allowed ? '영구 저장이 허용됐어요.' : '브라우저에서 영구 저장을 허용하지 않았어요. 백업을 사용해 주세요.'); }
        if (action === 'install') { if (installPrompt) { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = undefined; } else toast('브라우저 메뉴 → 앱 설치 또는 홈 화면에 추가를 선택해 주세요.'); }
        if (action === 'check-update') {
          updateChecking = true; updateMessage = '서버에서 새 버전을 확인하고 있어요…'; refreshUpdateControls();
          try {
            updateAvailable = await checkForUpdate(serviceWorkerRegistration) === 'available';
            updateMessage = updateAvailable ? '새 버전이 준비됐어요. 필기를 저장한 뒤 적용할 수 있어요.' : '최신 버전을 사용하고 있어요.';
          } catch (error) {
            updateMessage = error instanceof Error ? error.message : '업데이트를 확인하지 못했어요. 다시 시도해 주세요.';
            toast(updateMessage, true);
          } finally { updateChecking = false; refreshUpdateControls(); }
        }
        if (action === 'apply-update') {
          await applyUpdate();
        }
      } finally { el.removeAttribute('disabled'); }
    })));
  });
}
async function boot() {
  await initialize(); await navigation.start();
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.usage && estimate.quota && estimate.usage / estimate.quota > .8) toast('저장 공간이 거의 찼어요. 설정에서 백업해 주세요.', true);
}
boot().catch(error => { report(error); root.innerHTML = `<div class="boot-error"><h1>저장 공간을 열 수 없어요.</h1><p>${escape(error instanceof Error ? error.message : error)}</p><p>브라우저의 사이트 데이터 권한과 비공개 모드 설정을 확인해 주세요.</p><button class="button primary" onclick="location.reload()">다시 시도</button></div>`; });
