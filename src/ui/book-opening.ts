import type { Note } from '../data/model';
import { escape, safeColor } from './common';

let openingCount = 0;
export const isBookOpening = () => openingCount > 0;

function animate(element: HTMLElement, frames: Keyframe[], duration: number, easing = 'cubic-bezier(.22,.7,.2,1)') {
  const animation = element.animate(frames, { duration, easing, fill: 'forwards' });
  return animation.finished.catch(() => {});
}

export function beginBookOpening(root: HTMLElement, source: HTMLElement, note: Note) {
  openingCount++;
  const rect = source.getBoundingClientRect();
  const shell = root.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  const overlay = document.createElement('div');
  overlay.className = 'book-transition-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  const snapshot = document.createElement('div');
  snapshot.className = 'book-transition-snapshot';
  snapshot.inert = true;
  if (shell) {
    shell.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    const book = [...shell.querySelectorAll<HTMLElement>('.book-slot')].find(item => item.dataset.bookId === note.id);
    if (book) book.style.visibility = 'hidden';
    const sidebar = shell.querySelector<HTMLElement>('.library-sidebar');
    if (sidebar) { sidebar.style.position = 'absolute'; sidebar.style.top = `${window.scrollY}px`; sidebar.style.bottom = 'auto'; sidebar.style.height = '100dvh'; }
    shell.style.transform = `translateY(${-window.scrollY}px)`;
    const header = shell.querySelector<HTMLElement>('.library-topbar');
    const originalHeader = root.querySelector<HTMLElement>('.library-topbar');
    if (header && originalHeader && getComputedStyle(originalHeader).position === 'sticky') header.style.transform = `translateY(${window.scrollY}px)`;
    snapshot.append(shell);
  }
  overlay.append(snapshot);
  const flight = document.createElement('div');
  flight.className = 'book-transition-flight';
  flight.inert = true;
  flight.style.setProperty('--book-color', getComputedStyle(source).backgroundColor || safeColor(note.cover));
  flight.innerHTML = `<div class="book-transition-volume"><div class="book-transition-paper"><canvas aria-hidden="true"></canvas></div><div class="book-transition-cover"><span class="book-transition-brand">NOTELIN</span><strong>${escape(note.title)}</strong><span class="book-transition-cover-rule"></span><small>${note.pageIds.length} PAGES</small></div><div class="book-transition-edge"></div></div>`;
  overlay.append(flight);
  document.body.append(overlay);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches ||
    (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4) ||
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const dx = rect.left + rect.width / 2 - innerWidth / 2;
  const dy = rect.top + rect.height / 2 - innerHeight / 2;
  const scaleX = Math.max(.45, Math.min(1.5, rect.width / 56));
  const scaleY = Math.max(.45, Math.min(1.5, rect.height / 310));
  const start = `translate3d(${dx}px,${dy}px,0) scale(${scaleX},${scaleY}) rotateY(-74deg)`;
  const centered = 'translate3d(0,0,0) scale(1) rotateY(0deg)';
  flight.style.transform = start;
  let closed = false;
  const extract = reduced ? Promise.resolve() : animate(flight, [
    { transform: start, filter: 'drop-shadow(4px 7px 7px #2d344333)' },
    { transform: `translate3d(${dx * .8}px,${dy * .75}px,42px) scale(${scaleX * 1.1},${scaleY * 1.03}) rotateY(-68deg)`, offset: .28 },
    { transform: centered, filter: 'drop-shadow(15px 23px 20px #2d34433a)' },
  ], 430, 'cubic-bezier(.19,.82,.22,1)');
  if (reduced) flight.hidden = true;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    openingCount = Math.max(0, openingCount - 1);
    window.removeEventListener('popstate', cleanup);
  };
  window.addEventListener('popstate', cleanup, { once: true });
  const paintPage = (paper: HTMLElement) => {
    const canvas = flight.querySelector<HTMLCanvasElement>('canvas')!;
    canvas.width = 440; canvas.height = 620;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fffefa'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (const selector of ['#paper-background', '#paper-ink']) {
      const layer = paper.querySelector<HTMLCanvasElement>(selector);
      if (layer?.width && layer.height) context.drawImage(layer, 0, 0, canvas.width, canvas.height);
    }
  };
  return {
    cancel: cleanup,
    async finish(paper: HTMLElement | null) {
      try {
        await extract;
        if (closed || !paper) return;
        if (reduced) { await animate(snapshot, [{ opacity: 1 }, { opacity: 0 }], 160); return; }
        paintPage(paper);
        flight.style.transform = centered;
        const cover = flight.querySelector<HTMLElement>('.book-transition-cover')!;
        await animate(cover, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-164deg)' }], 245, 'cubic-bezier(.18,.7,.22,1)');
        if (closed) return;
        const target = paper.getBoundingClientRect();
        const end = `translate3d(${target.left + target.width / 2 - innerWidth / 2}px,${target.top + target.height / 2 - innerHeight / 2}px,0) scale(${target.width / 220},${target.height / 310}) rotateY(0deg)`;
        await Promise.all([
          animate(flight, [{ transform: centered, opacity: 1 }, { transform: end, opacity: 0 }], 185),
          animate(snapshot, [{ opacity: 1 }, { opacity: 0 }], 185),
        ]);
      } finally { cleanup(); }
    },
  };
}
