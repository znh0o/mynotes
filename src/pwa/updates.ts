import { approveAppReload } from './navigation';

export type UpdateResult = 'available' | 'latest';
declare const __NOTELIN_RELEASE__: string;

function workerRevision(worker: ServiceWorker): Promise<string | undefined> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => finish(new URL(worker.scriptURL).searchParams.get('revision') || undefined), 800);
    function finish(revision?: string) {
      clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(revision);
    }
    channel.port1.onmessage = event => finish(typeof event.data?.revision === 'string' ? event.data.revision : undefined);
    try { worker.postMessage({ type: 'NOTELIN_RELEASE' }, [channel.port2]); }
    catch { finish(); }
  });
}

// A waiting worker can be a duplicate registration of the version already open.
// Workbox's waiting event alone does not mean that new app code is available.
async function pendingWorker(registration: ServiceWorkerRegistration) {
  const worker = registration.waiting;
  if (!worker || worker.state !== 'installed') return;
  const revision = await workerRevision(worker) ?? await deployedRevision();
  if (registration.waiting !== worker || worker.state !== 'installed') return;
  return revision && revision !== __NOTELIN_RELEASE__ ? worker : undefined;
}

export async function hasWaitingUpdate(registration: ServiceWorkerRegistration): Promise<boolean> {
  return !!await pendingWorker(registration);
}

async function deployedRevision(): Promise<string | undefined> {
  const url = new URL(`${import.meta.env.BASE_URL}release.json`, location.origin);
  url.searchParams.set('checked', String(Date.now()));
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return;
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || !('revision' in data)) return;
    const revision = data.revision;
    return typeof revision === 'string' && /^[a-zA-Z0-9_-]{7,64}$/.test(revision) ? revision : undefined;
  } catch { return; }
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

export async function checkForUpdate(registration?: ServiceWorkerRegistration): Promise<UpdateResult> {
  if (!('serviceWorker' in navigator)) throw new Error('이 브라우저는 앱 업데이트를 지원하지 않아요.');
  if (!navigator.onLine) throw new Error('오프라인이에요. 인터넷에 연결한 뒤 업데이트를 확인해 주세요.');
  let current = registration ?? await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  if (!current) throw new Error('앱 등록을 준비하고 있어요. 잠시 후 다시 확인해 주세요.');
  if (await pendingWorker(current)) return 'available';
  const revision = await deployedRevision();
  const activeRevision = current.active ? await workerRevision(current.active) : undefined;
  if (revision && revision !== __NOTELIN_RELEASE__ && revision !== activeRevision) {
    // A versioned URL bypasses the hosting CDN's cached sw.js response.
    const workerUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, location.origin);
    workerUrl.searchParams.set('revision', revision);
    current = await navigator.serviceWorker.register(workerUrl, {
      scope: import.meta.env.BASE_URL, updateViaCache: 'none'
    });
  } else {
    await current.update();
  }
  const worker = current.installing;
  if (worker) await installed(worker);
  return await pendingWorker(current) ? 'available' : 'latest';
}

export async function applyWaitingUpdate(registration: ServiceWorkerRegistration | undefined, save: () => Promise<void>) {
  const current = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL) ?? registration;
  const waiting = current && await pendingWorker(current);
  if (!waiting) return 'latest' as const;
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
