import { db } from '../data/store';
import { thumbnail } from '../data/pdf';
import type { Page } from '../data/model';

// Small cached page previews are generated one at a time, only near the visible
// sidebar. Large PDFs do not block opening, writing, or zooming the active page.
export class PagePreviews {
  private observer?: IntersectionObserver;
  private pending: string[] = [];
  private queued = new Set<string>();
  private running = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private container: HTMLElement, private sidebar: HTMLElement, private busy: () => boolean,
    private ready: (id: string, preview: string, revision: number) => void) {}
  observe(pages: (Page | undefined)[]) {
    this.observer?.disconnect();
    if (this.stopped) return;
    const missing = new Set(pages.filter(p => p && !p.thumbnail).map(p => p!.id));
    const enqueue = (id: string) => {
      if (!missing.has(id) || this.queued.has(id)) return;
      this.pending.push(id); this.queued.add(id); void this.work();
    };
    const elements = this.container.querySelectorAll<HTMLElement>('[data-page-id]');
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) enqueue((entry.target as HTMLElement).dataset.pageId!);
      }, { root: this.sidebar, rootMargin: '250px' });
      elements.forEach(element => this.observer!.observe(element));
    } else elements.forEach((element, i) => { if (i < 8) enqueue(element.dataset.pageId!); });
  }
  private show(id: string, preview: string, revision: number) {
    if (this.stopped) return;
    const button = [...this.container.querySelectorAll<HTMLElement>('[data-page-id]')].find(el => el.dataset.pageId === id);
    const paper = button?.querySelector('.page-thumb-paper');
    if (paper) {
      const image = document.createElement('img'); image.src = preview;
      image.alt = `${button!.getAttribute('aria-label')} 미리보기`; paper.replaceChildren(image);
    }
    this.ready(id, preview, revision);
  }
  private async work() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (this.pending.length && !this.stopped) {
        if (this.busy()) break;
        const id = this.pending.shift()!;
        try {
          const page = await db.pages.get(id); if (!page) continue;
          if (page.thumbnail) { this.show(id, page.thumbnail, page.revision); continue; }
          const preview = await thumbnail(page); if (this.stopped) return;
          const accepted = await db.transaction('rw', db.pages, db.notes, async () => {
            const latest = await db.pages.get(id);
            if (!latest || latest.revision !== page.revision) return false;
            await db.pages.update(id, { thumbnail: preview });
            const note = await db.notes.get(page.noteId);
            if (note?.pageIds[0] === id) await db.notes.update(note.id, { thumbnail: preview });
            return true;
          });
          if (accepted) this.show(id, preview, page.revision);
        } catch (error) { console.warn('Page preview unavailable; original page remains accessible.', error); }
        finally { this.queued.delete(id); }
        await new Promise(resolve => setTimeout(resolve, 32));
      }
    } finally {
      this.running = false;
      if (!this.stopped && this.pending.length) this.timer = setTimeout(() => void this.work(), 180);
    }
  }
  destroy() { this.stopped = true; clearTimeout(this.timer); this.observer?.disconnect(); this.pending = []; this.queued.clear(); }
}
