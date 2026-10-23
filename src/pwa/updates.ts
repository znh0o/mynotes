import { approveAppReload } from './navigation';

export type UpdateResult = 'available' | 'latest';
declare const __NOTELIN_RELEASE__: string;

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
  if (current.waiting) return 'available';
  const revision = await deployedRevision();
  if (revision && revision !== __NOTELIN_RELEASE__) {
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
  return current.waiting ? 'available' : 'latest';
}

export async function applyWaitingUpdate(registration: ServiceWorkerRegistration | undefined, save: () => Promise<void>) {
  const current = registration ?? await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const waiting = current?.waiting;
  if (!waiting) throw new Error('적용할 새 버전이 없어요. 업데이트를 먼저 확인해 주세요.');
  await save();
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
