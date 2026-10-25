import { approveAppReload } from './navigation';

export type UpdateResult = 'available' | 'latest';
declare const __NOTELIN_RELEASE__: string;

// A double leading path slash is served by Pages but lies outside the installed
// /mynotes/ worker's scope. Even an older cached app cannot intercept this page.
export const updateRepairUrl = () => `${location.origin}/${import.meta.env.BASE_URL}repair.html`;

function workerRevision(worker: ServiceWorker): Promise<string | undefined> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => finish(new URL(worker.scriptURL).searchParams.get('revision') || undefined), 2500);
    function finish(revision?: string) {
      clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(revision);
    }
    channel.port1.onmessage = event => finish(typeof event.data?.revision === 'string' ? event.data.revision : undefined);
    try { worker.postMessage({ type: 'NOTELIN_RELEASE' }, [channel.port2]); }
    catch { finish(); }
  });
}

// Only a worker whose own revision is known can be offered for installation.
// The server marker cannot identify the contents of an unrelated waiting worker.
async function pendingWorker(registration: ServiceWorkerRegistration, expectedRevision?: string) {
  const worker = registration.waiting;
  if (!worker || worker.state !== 'installed') return;
  const revision = await workerRevision(worker);
  if (registration.waiting !== worker || worker.state !== 'installed') return;
  return revision && revision !== __NOTELIN_RELEASE__ && (!expectedRevision || revision === expectedRevision) ? worker : undefined;
}

async function activeRelease(registration: ServiceWorkerRegistration, expectedRevision: string) {
  return expectedRevision !== __NOTELIN_RELEASE__ &&
    !!registration.active && await workerRevision(registration.active) === expectedRevision;
}

export async function hasReadyUpdate(registration: ServiceWorkerRegistration): Promise<boolean> {
  const revision = await deployedRevision();
  if (revision === __NOTELIN_RELEASE__) return false;
  return !!await pendingWorker(registration, revision) || await activeRelease(registration, revision);
}

async function deployedRevision(): Promise<string> {
  const url = new URL(`${import.meta.env.BASE_URL}release.json`, location.origin);
  url.searchParams.set('checked', String(Date.now()));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || !('revision' in data)) throw new Error('Invalid release marker');
    const revision = data.revision;
    if (typeof revision !== 'string' || !/^[a-zA-Z0-9._-]{7,64}$/.test(revision)) throw new Error('Invalid release revision');
    return revision;
  } catch {
    throw new Error('서버의 버전 정보를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
  } finally { clearTimeout(timeout); }
}

function installed(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('업데이트 다운로드가 지연되고 있어요. 연결을 확인하고 다시 시도해 주세요.')), 25000);
    function finish(error?: Error) {
      clearTimeout(timer); worker.removeEventListener('statechange', changed);
      if (error) reject(error); else resolve();
    }
    function changed() {
      if (worker.state === 'installed' || worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('업데이트를 다운로드하지 못했어요. 다시 시도해 주세요.'));
    }
    worker.addEventListener('statechange', changed); changed();
  });
}

let checking: Promise<UpdateResult> | undefined;
export function checkForUpdate(registration?: ServiceWorkerRegistration): Promise<UpdateResult> {
  return checking ??= performUpdateCheck(registration).finally(() => { checking = undefined; });
}

async function performUpdateCheck(registration?: ServiceWorkerRegistration): Promise<UpdateResult> {
  if (!('serviceWorker' in navigator)) throw new Error('이 브라우저는 앱 업데이트를 지원하지 않아요.');
  if (!navigator.onLine) throw new Error('오프라인이에요. 인터넷에 연결한 뒤 업데이트를 확인해 주세요.');
  let current = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL) ?? registration;
  if (!current) throw new Error('앱 등록을 준비하고 있어요. 잠시 후 다시 확인해 주세요.');
  const revision = await deployedRevision();
  if (revision === __NOTELIN_RELEASE__) return 'latest';
  if (await pendingWorker(current, revision) || await activeRelease(current, revision)) return 'available';
  const registerFresh = (retry = false) => {
    const workerUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, location.origin);
    workerUrl.searchParams.set('revision', revision);
    if (retry) workerUrl.searchParams.set('retry', String(Date.now()));
    return navigator.serviceWorker.register(workerUrl, {
      scope: import.meta.env.BASE_URL, updateViaCache: 'none'
    });
  };
  try {
    current = await registerFresh();
  } catch (originalError) {
    // Recover a failed script fetch without unregistering the working app or
    // deleting any of its storage. A fresh URL also bypasses a stale CDN entry.
    try { current = await registerFresh(true); }
    catch (error) {
      console.warn('Service worker refresh failed', originalError, error);
      throw new Error('업데이트 파일을 받지 못했어요. 인터넷 연결을 확인하고 다시 시도하거나 업데이트 복구를 열어 주세요.');
    }
  }
  const worker = current.installing;
  if (worker) await installed(worker);
  if (await pendingWorker(current, revision) || await activeRelease(current, revision)) return 'available';
  throw new Error('새 버전을 아직 준비하지 못했어요. 잠시 후 다시 확인해 주세요.');
}

export async function applyWaitingUpdate(registration: ServiceWorkerRegistration | undefined, save: () => Promise<void>) {
  const deployed = navigator.onLine ? await deployedRevision().catch(() => undefined) : undefined;
  if (deployed === __NOTELIN_RELEASE__) return 'latest' as const;
  let current = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL) ?? registration;
  let waiting = current && await pendingWorker(current, deployed);
  let activeRevision = current?.active && await workerRevision(current.active);
  if (activeRevision && activeRevision !== __NOTELIN_RELEASE__ && (!deployed || activeRevision === deployed)) {
    await save(); approveAppReload(); location.reload(); return;
  }
  if (!waiting && (!activeRevision || activeRevision === __NOTELIN_RELEASE__)) {
    if (await checkForUpdate(current) === 'latest') return 'latest' as const;
    current = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL) ?? current;
    waiting = current && await pendingWorker(current, deployed);
    activeRevision = current?.active && await workerRevision(current.active);
  }
  if (!waiting) {
    if (!activeRevision || activeRevision === __NOTELIN_RELEASE__) return 'latest' as const;
    await save(); approveAppReload(); location.reload(); return;
  }
  await save();
  if (waiting.state === 'activated') { approveAppReload(); location.reload(); return; }
  if (current?.waiting !== waiting || waiting.state !== 'installed') return 'latest' as const;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('업데이트 적용이 지연되고 있어요. 잠시 후 다시 시도해 주세요.')), 20000);
    let completed = false;
    function finish(error?: Error) {
      if (completed) return; completed = true;
      clearTimeout(timeout); navigator.serviceWorker.removeEventListener('controllerchange', activated); waiting!.removeEventListener('statechange', changed);
      if (error) reject(error); else { approveAppReload(); resolve(); location.reload(); }
    }
    function activated() { finish(); }
    function changed() { if (waiting!.state === 'activated') finish(); else if (waiting!.state === 'redundant') finish(new Error('새 버전을 적용하지 못했어요. 다시 확인해 주세요.')); }
    navigator.serviceWorker.addEventListener('controllerchange', activated);
    waiting.addEventListener('statechange', changed); waiting.postMessage({ type: 'SKIP_WAITING' }); changed();
  });
}
