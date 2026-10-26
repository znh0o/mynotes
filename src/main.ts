import './style.css';
import './theme.css';
import { registerSW } from 'virtual:pwa-register';
import { backup, db, initialize, restore, deletePermanently, discardTemporaryNotes } from './data/store';
import { importPDF } from './data/pdf';
import { EditorView } from './ui/editor';
import { LibraryView, type LibraryState } from './ui/library';
import { AppHistory, type AppRoute, type Direction } from './ui/history';
import { finishSlide, slidePreviousView } from './ui/transitions';
import { escape, icon, modal, pickFile, report, run, toast } from './ui/common';
import { checkForUpdate, applyWaitingUpdate, hasReadyUpdate, updateRepairUrl } from './pwa/updates';
import { version as appVersion } from '../package.json';
import { installAppZoomGuard } from './ui/app-zoom';
import { getAppearance, setAppearance, type Appearance } from './ui/appearance';
import { installDeviceUI } from './ui/device-ui';
import { isNativeApp, initializeNativeShell, pendingNativeDocuments, readNativeDocument, completeNativeDocument, onNativeDocument, openNativeUpdates } from './platform/native';
import { checkNativeUpdate, installNativeUpdate, onNativeUpdateProgress, type NativeUpdate } from './platform/native-updates';

installAppZoomGuard();
installDeviceUI();

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
let updateMessage = '새 버전을 자동으로 확인하고 있어요.';
let lastUpdateCheck = 0;
let updateProbeRunning = false;
let apkUpdate: NativeUpdate | undefined;
function showAvailableUpdate() {
  const newlyAvailable = !updateAvailable;
  updateAvailable = true;
  updateMessage = '새 버전이 준비됐어요. 필기를 저장한 뒤 적용할 수 있어요.';
  refreshUpdateControls();
  if (newlyAvailable) toast('새 버전이 준비됐어요. 서재의 업데이트 버튼을 눌러 적용하세요.');
}
function showLatestVersion() {
  updateAvailable = false; updateMessage = '최신 버전을 사용하고 있어요.'; refreshUpdateControls();
}
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
    const result = await applyWaitingUpdate(serviceWorkerRegistration, async () => {
      await editor?.flush(); updateMessage = '저장했어요. 새 버전을 적용하고 있어요…'; refreshUpdateControls();
    });
    if (result === 'latest') { showLatestVersion(); toast('최신 버전을 사용하고 있어요.'); }
  } finally { updateApplying = false; refreshUpdateControls(); }
}
function watchServiceWorker(registration: ServiceWorkerRegistration) {
  serviceWorkerRegistration = registration;
  const noticeIfReady = () => {
    void hasReadyUpdate(registration).then(available => {
      if (available) showAvailableUpdate();
    }).catch(() => {});
  };
  registration.addEventListener('updatefound', () => {
    registration.installing?.addEventListener('statechange', noticeIfReady);
    noticeIfReady();
  });
  navigator.serviceWorker.addEventListener('controllerchange', noticeIfReady);
  refreshUpdateControls(); void probeUpdate();
}
async function registerAppWorker() {
  const existing = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const activeUrl = existing?.active && new URL(existing.active.scriptURL);
  if (existing && activeUrl?.pathname === `${import.meta.env.BASE_URL}sw.js` && activeUrl.searchParams.has('revision')) {
    // Keep the revisioned script URL after applying it; registering plain sw.js
    // here would create a second, spurious update on every launch.
    watchServiceWorker(existing);
    return;
  }
  registerSW({
    immediate: true,
    onNeedReload() { /* Manual activation below reloads only after saving. */ },
    onOfflineReady() { toast('오프라인 사용 준비가 완료됐어요.'); },
    onNeedRefresh() { if (serviceWorkerRegistration) void hasReadyUpdate(serviceWorkerRegistration).then(available => { if (available) showAvailableUpdate(); }); },
    onRegisteredSW(_url, registration) { if (registration) watchServiceWorker(registration); },
    onRegisterError(error) { console.error('Service Worker registration failed', error); toast('오프라인 설치를 준비하지 못했어요. 연결을 확인해 주세요.', true); }
  });
}
if (!isNativeApp && 'serviceWorker' in navigator) void registerAppWorker().catch(error => {
  console.error('Service Worker registration failed', error);
  toast('오프라인 설치를 준비하지 못했어요. 연결을 확인해 주세요.', true);
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e as typeof installPrompt; });
window.addEventListener('appinstalled', () => { installPrompt = undefined; toast('Notelin이 설치됐어요.'); });
window.addEventListener('offline', () => toast('오프라인이에요. 이 기기에서 계속 필기할 수 있어요.'));
async function probeUpdate() {
  if (document.hidden || !navigator.onLine || !serviceWorkerRegistration || updateApplying || updateChecking || updateProbeRunning || Date.now() - lastUpdateCheck < 15000) return;
  lastUpdateCheck = Date.now(); updateProbeRunning = true;
  try {
    if (await checkForUpdate(serviceWorkerRegistration) === 'available') showAvailableUpdate();
    else showLatestVersion();
  } catch { /* Keep writing available when the network check fails. */ }
  finally { updateProbeRunning = false; }
}
window.addEventListener('focus', () => { void probeUpdate(); });
window.addEventListener('online', () => { void probeUpdate(); });
document.addEventListener('visibilitychange', () => { void probeUpdate(); });
window.addEventListener('notelin-pause', () => { void editor?.flush().catch(report); });
setInterval(() => { void probeUpdate(); }, 60 * 1000);

async function home() {
  if (editor) await navigation.goHome();
  else await library?.show();
}
async function open(id: string) {
  await navigation.navigate({ screen: 'note', id });
}
function createLibrary() {
  return new LibraryView(root, open, settings, filter => navigation.navigate({ screen: 'library', filter }), libraryState, applyUpdate);
}
async function renderRoute(route: AppRoute, direction: Direction) {
  if (route.screen === 'library' && library && !editor) {
    library.setFilter(route.filter); libraryState = library.snapshot(); return;
  }
  const note = route.screen === 'note' ? await db.notes.get(route.id) : undefined;
  if (route.screen === 'note' && (!note || note.deleted)) throw new Error('노트를 찾을 수 없어요.');
  finishSlide(); const previous = root.firstElementChild, oldScroll = window.scrollY, wasEditor = !!editor;
  if (library) { libraryState = library.snapshot(); libraryScroll = oldScroll; library.destroy(); library = undefined; }
  if (editor) {
    const previousNote = editor.note;
    await editor.flush(); editor.destroy(); editor = undefined;
    if (previousNote.temporary && (route.screen !== 'note' || route.id !== previousNote.id)) {
      await deletePermanently(previousNote);
      const index = tabs.findIndex(tab => tab.id === previousNote.id);
      if (index >= 0) tabs.splice(index, 1);
      toast('서재에 저장하지 않은 PDF를 닫았어요.');
    }
  }
  if (route.screen === 'library') {
    const restoreScroll = libraryState.filter === route.filter ? libraryScroll : 0;
    libraryState = { ...libraryState, filter: route.filter };
    library = createLibrary();
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
    const standalone = isNativeApp || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
    const dialog = modal('Notelin 설정', `<p class="muted settings-version">버전 ${escape(appVersion)}</p><div class="settings-section"><h3>${icon('HardDrive', 18)} 저장 공간</h3><div class="storage-row"><span>이 기기에서 사용 중</span><strong>${usage}</strong></div><p class="muted">${persisted ? '브라우저 영구 저장이 허용되어 있어요.' : '브라우저 정리로 데이터가 지워질 수 있어요. 중요한 노트는 별도로 백업해 주세요.'}</p><button type="button" class="button secondary" data-setting="persist">${icon('ShieldCheck', 16)} 영구 저장 요청</button></div><div class="settings-section"><h3>${icon('Download', 18)} 백업 및 복원</h3><p class="muted">노트, 필기, PDF와 이미지를 하나의 파일에 담아요. 복원은 기존 노트를 유지하며 사본으로 추가합니다.</p><div class="settings-actions"><button class="button secondary" type="button" data-setting="backup">전체 백업</button><button class="button secondary" type="button" data-setting="restore">백업 파일 복원</button></div></div><div class="settings-section"><h3>${icon('BookOpen', 18)} 앱으로 사용하기</h3><p class="muted">${standalone ? '설치된 앱으로 사용하고 있어요.' : 'Chrome 또는 Samsung Internet 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택해 주세요. 첫 방문 시 온라인 연결이 필요합니다.'}</p>${!standalone ? '<button class="button primary" type="button" data-setting="install">Notelin 설치</button>' : ''}</div><div class="settings-section"><h3>${icon('RefreshCw', 18)} 앱 업데이트</h3><p class="muted settings-update-status" id="update-status" role="status" aria-live="polite">${escape(updateMessage)}</p><div class="settings-actions"><button class="button secondary" type="button" data-setting="check-update">업데이트 확인</button><button class="button primary" type="button" data-setting="apply-update" hidden>저장 후 새 버전 적용</button><a class="button secondary" href="${escape(updateRepairUrl())}" target="_blank" rel="noopener">업데이트 복구</a></div></div><p class="muted settings-footnote">손글씨는 편집 가능한 획으로 저장됩니다. 손글씨 인식, 기기 간 동기화는 아직 지원하지 않습니다. 웹 팜 리젝션과 S펜 버튼 동작은 브라우저에 따라 다를 수 있습니다.</p>`, '완료', () => {});
    const appearanceSection = document.createElement('section');
    appearanceSection.className = 'settings-section appearance-section';
    appearanceSection.innerHTML = `<h3>${icon('Moon', 18)} 화면 모드</h3><p class="muted">화면의 밝기를 편한 방식으로 선택하세요.</p><div class="appearance-options" role="group" aria-label="화면 모드">${([['light', 'Sun', '라이트'], ['dark', 'Moon', '다크'], ['system', 'Monitor', '기기 설정']] as const).map(([value, symbol, label]) => `<button type="button" data-appearance="${value}" aria-pressed="${getAppearance() === value}">${icon(symbol, 20)}<span>${label}</span></button>`).join('')}</div>`;
    dialog.querySelector('.settings-section')!.after(appearanceSection);
    appearanceSection.querySelectorAll<HTMLElement>('[data-appearance]').forEach(button => button.addEventListener('click', () => setAppearance(button.dataset.appearance as Appearance)));
    dialog.querySelector('footer [data-close]')?.remove();
    if (isNativeApp) {
      const storage = dialog.querySelector('[data-setting=persist]')!.closest('.settings-section')!;
      storage.querySelector('p')!.textContent = '노트는 Notelin 앱 저장 공간에 보관됩니다. 앱 삭제나 앱 데이터 초기화에 대비해 백업 파일을 보관해 주세요.';
      storage.querySelector('[data-setting=persist]')!.remove();
      const update = dialog.querySelector('#update-status')!.closest('.settings-section')!;
      update.innerHTML = `<h3>${icon('RefreshCw', 18)} 앱 업데이트</h3><p class="muted" id="apk-update-status" role="status" aria-live="polite">설치 버전 ${escape(appVersion)} · 업데이트를 확인할 수 있어요.</p><progress id="apk-update-progress" max="100" value="0" hidden aria-label="업데이트 다운로드"></progress><div class="settings-actions"><button class="button secondary" type="button" data-setting="check-apk-update">업데이트 확인</button><button class="button primary" type="button" data-setting="install-apk-update" ${apkUpdate?.available ? '' : 'hidden'}>다운로드 후 설치</button></div><p class="muted">설치 확인을 마치면 저장한 노트를 유지하며 업데이트돼요.</p>`;
      const listener = await onNativeUpdateProgress(({ percent }) => {
        if (!dialog.isConnected) return;
        dialog.querySelector('#apk-update-status')!.textContent = `업데이트 다운로드 중 ${percent}%`;
        const progress = dialog.querySelector<HTMLProgressElement>('#apk-update-progress')!;
        progress.hidden = false; progress.value = percent;
      });
      dialog.addEventListener('close', () => { void listener.remove(); }, { once: true });
      dialog.querySelector('.settings-footnote')!.textContent = '다른 앱에서 PDF를 열거나 공유할 때 Notelin을 선택할 수 있어요. 기존 PWA의 노트는 전체 백업 파일로 복원하세요.';
    }
    void Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]).then(([estimate, persisted]) => {
      if (!dialog.isConnected) return;
      dialog.querySelector('.storage-row strong')!.textContent = estimate?.usage ? `${(estimate.usage / 1024 / 1024).toFixed(1)} MB` : '사용량 확인 불가';
      if (!isNativeApp) dialog.querySelector('.settings-section p')!.textContent = persisted ? '브라우저 영구 저장이 허용되어 있어요.' : '브라우저 정리로 데이터가 지워질 수 있어요. 중요한 노트는 별도로 백업해 주세요.';
    }).catch(() => {});
    refreshUpdateControls();
    dialog.querySelectorAll<HTMLElement>('[data-setting]').forEach(el => el.addEventListener('click', () => run(async () => {
      const action = el.dataset.setting; el.setAttribute('disabled', '');
      try {
        if (action === 'backup') { await editor?.flush(); const saved = await backup(); toast(saved === false ? '저장을 취소했어요.' : '백업 파일을 만들었어요.'); }
        if (action === 'apk-updates') await openNativeUpdates();
        if (action === 'check-apk-update') {
          const status = dialog.querySelector('#apk-update-status')!;
          status.textContent = '새 버전을 확인하고 있어요…';
          try {
            apkUpdate = await checkNativeUpdate();
            status.textContent = apkUpdate.available ? `${apkUpdate.version} 업데이트가 있어요.` : `최신 버전(${apkUpdate.installedVersion})을 사용하고 있어요.`;
            dialog.querySelector<HTMLElement>('[data-setting=install-apk-update]')!.hidden = !apkUpdate.available;
          } catch (error) { status.textContent = error instanceof Error ? error.message : '업데이트를 확인하지 못했어요.'; }
        }
        if (action === 'install-apk-update') {
          const status = dialog.querySelector('#apk-update-status')!;
          status.textContent = '설치 파일을 준비하고 있어요…';
          try {
            await editor?.flush();
            const result = await installNativeUpdate();
            status.textContent = result.needsPermission ? '이 앱에서 설치를 허용한 뒤 돌아오면 설치 창이 열려요.' : 'Android 설치 창에서 업데이트를 확인해 주세요.';
          } catch (error) { status.textContent = error instanceof Error ? error.message : '업데이트를 설치하지 못했어요.'; }
          finally { dialog.querySelector<HTMLProgressElement>('#apk-update-progress')!.hidden = true; }
        }
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
  await initialize();
  await discardTemporaryNotes();
  await navigation.start();
  if (isNativeApp) {
    await initializeNativeShell();
    await onNativeDocument(() => { void receiveNativeDocuments(); });
    await receiveNativeDocuments();
  }
  await receiveSharedPdf();
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.usage && estimate.quota && estimate.usage / estimate.quota > .8) toast('저장 공간이 거의 찼어요. 설정에서 백업해 주세요.', true);
}
let receivingNativeDocuments = false;
async function receiveNativeDocuments() {
  if (receivingNativeDocuments) return;
  receivingNativeDocuments = true;
  try {
    for (;;) {
      const { documents } = await pendingNativeDocuments();
      if (!documents.length) break;
      for (const document of documents) {
        try {
          toast('PDF를 가져오는 중이에요…');
          await editor?.flush();
          const note = await importPDF(await readNativeDocument(document), null, true);
          await completeNativeDocument(document.id);
          await open(note.id);
        } catch (error) { await completeNativeDocument(document.id); report(error); }
      }
    }
  } catch (error) { report(error); }
  finally { receivingNativeDocuments = false; }
}
async function receiveSharedPdf() {
  const url = new URL(location.href);
  const token = url.searchParams.get('shared-pdf');
  const shareError = url.searchParams.get('share-error');
  if (!token && !shareError) return;
  const clearShareUrl = () => {
    url.searchParams.delete('shared-pdf'); url.searchParams.delete('share-error');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  };
  if (shareError) {
    clearShareUrl();
    toast(shareError === 'size' ? 'PDF는 150MB 이하로 가져올 수 있어요.' :
      shareError === 'type' ? 'PDF 파일을 공유해 주세요.' : '공유한 PDF를 받지 못했어요. 다시 공유해 주세요.', true);
    return;
  }
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) { clearShareUrl(); return; }
  const key = new URL(`shared-pdf/${token}`, new URL(import.meta.env.BASE_URL, location.origin));
  let cache: Cache | undefined;
  try {
    cache = await caches.open('notelin-shared-pdfs-v1');
    const response = await cache.match(key.href);
    if (!response) throw new Error('공유한 PDF를 찾지 못했어요. 다시 공유해 주세요.');
    const encodedName = response.headers.get('X-Notelin-Filename');
    const name = encodedName ? decodeURIComponent(encodedName) : '공유한 PDF.pdf';
    const file = new File([await response.blob()], name, { type: 'application/pdf' });
    toast('PDF를 가져오는 중이에요…');
    const note = await importPDF(file, null, true);
    clearShareUrl();
    await open(note.id);
  } catch (error) { report(error); }
  finally {
    if (cache) await cache.delete(key.href).catch(() => {});
    clearShareUrl();
  }
}
boot().catch(error => { report(error); root.innerHTML = `<div class="boot-error"><h1>저장 공간을 열 수 없어요.</h1><p>${escape(error instanceof Error ? error.message : error)}</p><p>브라우저의 사이트 데이터 권한과 비공개 모드 설정을 확인해 주세요.</p><button class="button primary" onclick="location.reload()">다시 시도</button></div>`; });
