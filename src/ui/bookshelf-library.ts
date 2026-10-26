import { db, persistNew, deletePermanently } from '../data/store';
import { covers, createNote, paperNames, uid, type Folder, type Note, type Paper } from '../data/model';
import { importPDF } from '../data/pdf';
import { icon, button, escape, safeColor, modal, toast, run, pickFile, contextMenu, confirmAction, formatDate } from './common';
import { bindPhoneLibrary } from './phone-chrome';
import { beginBookOpening } from './book-opening';
import { libraryModeSwitch } from './library-mode';
import { bindBookReordering } from './book-reordering';
export interface LibraryState { filter: string; query: string; sort: string; list: boolean }
interface Profile { name: string; school: string; grade: string; classroom: string }
const emptyProfile = (): Profile => ({ name: '', school: '', grade: '', classroom: '' });
function profileFrom(value: unknown): Profile {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const field = (key: keyof Profile, max: number) => {
    const raw = input[key]; return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
  };
  return { name: field('name', 40), school: field('school', 80), grade: field('grade', 20), classroom: field('classroom', 20) };
}

export class BookshelfLibraryView {
  private notes: Note[] = [];
  private folders: Folder[] = [];
  private filter = 'all';
  private query = '';
  private sort = 'updated';
  private list = false;
  private columns: 'auto' | 4 | 5 | 6 = 'auto';
  private abort = new AbortController();
  private selectedBook: string | null = null;
  private arrangement: 'recent' | 'folders' | 'custom' = 'recent';
  private customOrder: string[] = [];
  private visibleOrder: string[] = [];
  private openingBook = false;
  private movedPointer: number | null = null;
  private pointerStart: { x: number; y: number; scroll: number } | null = null;
  private updateAvailable = false;
  private updateApplying = false;
  private profile = emptyProfile();
  private phoneCleanup?: () => void;
  constructor(private root: HTMLElement, private openNote: (id: string) => Promise<void>, private settings: () => void,
    private navigateFilter: (filter: string) => Promise<void> = async filter => this.setFilter(filter), initial?: LibraryState,
    private applyUpdate: () => Promise<void> = async () => {}, private changeMode: (mode: 'classic' | 'bookshelf') => Promise<void> = async () => {}) {
    if (initial) { this.query = initial.query; this.sort = initial.sort; this.list = initial.list; }
    root.addEventListener('click', e => this.click(e), { signal: this.abort.signal });
    root.addEventListener('input', e => {
      const el = e.target as HTMLInputElement;
      if (el.id === 'library-search' || el.id === 'library-search-mobile') {
        this.query = el.value;
        const other = root.querySelector<HTMLInputElement>(el.id === 'library-search' ? '#library-search-mobile' : '#library-search');
        if (other) other.value = el.value;
        this.renderResults();
      }
    }, { signal: this.abort.signal });
    root.addEventListener('pointerdown', e => {
      const target = (e.target as Element).closest<HTMLElement>('.bookshelf');
      this.movedPointer = null;
      this.pointerStart = target ? { x: e.clientX, y: e.clientY, scroll: window.scrollY } : null;
    }, { signal: this.abort.signal });
    root.addEventListener('pointermove', e => {
      if (this.pointerStart && Math.hypot(e.clientX - this.pointerStart.x, e.clientY - this.pointerStart.y) > 9) this.movedPointer = e.pointerId;
    }, { signal: this.abort.signal });
    root.addEventListener('pointerup', e => {
      if (this.pointerStart && Math.abs(window.scrollY - this.pointerStart.scroll) > 3) this.movedPointer = e.pointerId;
      const target = e.target as Element;
      if (this.pointerStart && this.movedPointer === null && target.closest('.bookshelf') && !target.closest('[data-action]')) this.selectBook(null);
      this.pointerStart = null;
    }, { signal: this.abort.signal });
    root.addEventListener('pointercancel', e => { this.pointerStart = null; this.movedPointer = e.pointerId; }, { signal: this.abort.signal });
    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { if (!this.openingBook) this.renderResults(); });
    }, { signal: this.abort.signal });
    this.abort.signal.addEventListener('abort', () => cancelAnimationFrame(resizeFrame), { once: true });
    root.addEventListener('change', e => {
      const el = e.target as HTMLSelectElement;
      if (el.id === 'sort') { this.sort = el.value; this.renderResults(); }
    }, { signal: this.abort.signal });
    root.addEventListener('submit', e => this.submitProfile(e), { signal: this.abort.signal });
    document.addEventListener('pointerdown', e => {
      if (!(e.target instanceof Element) || !e.target.closest('.profile-anchor')) this.closeProfile();
    }, { signal: this.abort.signal });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.selectedBook && !this.openingBook) { this.selectBook(null); return; }
      if (e.key === 'Escape' && this.root.querySelector<HTMLElement>('.profile-popover:not([hidden])')) {
        e.preventDefault(); e.stopPropagation(); this.closeProfile(); this.root.querySelector<HTMLButtonElement>('.avatar')?.focus();
      }
    }, { signal: this.abort.signal });
    bindBookReordering(root, this.abort.signal, (id, target, before) => this.moveBook(id, target, before));
  }
  async show() {
    const [notes, folders, profile, arrangement, order] = await Promise.all([db.notes.toArray(), db.folders.toArray(), db.settings.get('user-profile'), db.settings.get('bookshelf-arrangement'), db.settings.get('bookshelf-custom-order')]);
    this.notes = notes; this.folders = folders;
    this.arrangement = arrangement?.value === 'folders' || arrangement?.value === 'custom' ? arrangement.value : 'recent';
    this.customOrder = Array.isArray(order?.value) ? [...new Set(order.value.filter((id): id is string => typeof id === 'string'))] : [];
    this.profile = profileFrom(profile?.value);
    this.render();
  }
  setUpdateState(available: boolean, applying: boolean) {
    if (this.updateAvailable === available && this.updateApplying === applying) return;
    this.updateAvailable = available; this.updateApplying = applying;
    const banner = this.root.querySelector<HTMLElement>('.welcome-banner');
    if (banner) { banner.hidden = !available; banner.innerHTML = this.bannerContent(); }
  }
  private bannerContent() {
    return `<div role="status" aria-live="polite"><span>${icon('RefreshCw', 18)}</span><div><strong>업데이트가 있어요</strong><p>노트를 저장한 뒤 새 버전을 적용합니다.</p></div></div><button class="button primary banner-update-button" data-action="apply-update" ${this.updateApplying ? 'disabled' : ''}>${this.updateApplying ? '적용 중…' : '지금 업데이트'}</button>`;
  }
  snapshot(): LibraryState { return { filter: this.filter, query: this.query, sort: this.sort, list: this.list }; }
  setFilter(_filter: string) { this.filter = 'all'; this.renderResults(); }
  private render() {
    this.phoneCleanup?.();
    document.title = 'Notelin · 나의 서재';
    const active = this.notes.filter(n => !n.deleted);
    this.root.innerHTML = `<div class="library-shell bookshelf-library">
      <aside class="library-sidebar" id="phone-library-sidebar">
        <button class="brand brand-logo" data-action="filter" data-id="all" aria-label="Notelin 홈"><img class="brand-wordmark" src="${import.meta.env.BASE_URL}notelin-wordmark-lockup.png" alt="" aria-hidden="true" /></button>
        <nav aria-label="서재 탐색">
          ${this.nav('all', 'Library', '모든 노트', active.length)}
          ${this.nav('recent', 'Clock', '최근 사용한 노트')}
          ${this.nav('favorites', 'Star', '즐겨찾기', active.filter(n => n.favorite).length)}
        </nav>
        <div class="sidebar-section-title">내 폴더 ${button('Plus', '새 폴더', 'new-folder')}</div>
        <nav class="folder-nav" aria-label="내 폴더">${this.folders.length ? this.folders.map(f => `<div class="folder-row">${this.nav(f.id, 'Folder', f.name, active.filter(n => n.folderId === f.id).length, f.color)}${button('MoreHorizontal', `${f.name} 관리`, `folder-menu`, `data-id="${f.id}"`)}</div>`).join('') : '<p class="sidebar-empty">폴더 없음</p>'}</nav>
        <button class="add-folder" data-action="new-folder">${icon('FolderPlus', 17)} 새 폴더 만들기</button>
        <div class="sidebar-bottom">
          ${this.nav('trash', 'Trash2', '휴지통', this.notes.filter(n => n.deleted).length)}
          <button class="nav-item" data-action="settings">${icon('Settings2')}<span>설정 및 백업</span></button>
        </div>
      </aside>
      <div class="library-main">
        <header class="library-topbar"><div class="shelf-top-brand"><img src="${import.meta.env.BASE_URL}notelin-wordmark-lockup.png" alt="Notelin" /><span>LIBRARY</span></div><div class="topbar-right"><label class="search-field shelf-search">${icon('Search', 17)}<input id="library-search" type="search" placeholder="노트 검색" aria-label="노트 검색" value="${escape(this.query)}" /></label>${libraryModeSwitch('bookshelf')}<button class="button primary shelf-new" data-action="new">${icon('Plus', 18)} 새 노트</button><div class="profile-anchor"><button class="avatar" type="button" data-action="profile" aria-label="프로필" aria-expanded="false" aria-controls="profile-popover">${escape(this.profileInitial())}</button><div class="profile-popover" id="profile-popover" role="dialog" aria-label="프로필" hidden></div></div></div></header>
        <main class="library-content">
          <div class="page-heading"><div><span class="shelf-eyebrow">THE NOTEBOOK SHELF</span><h1 id="library-title">나의 책장<span class="heading-dot">.</span></h1><p id="library-subtitle"></p></div><div class="heading-actions"><button class="button secondary" data-action="import">${icon('Upload', 18)} PDF 가져오기</button></div></div>
          <label class="search-field shelf-mobile-search">${icon('Search', 17)}<input id="library-search-mobile" type="search" placeholder="노트 검색" aria-label="노트 검색" value="${escape(this.query)}" /></label>
          <section class="welcome-banner" ${this.updateAvailable ? '' : 'hidden'}>${this.bannerContent()}</section>
          <section class="notes-section" aria-label="책장"><div class="collection-toolbar"><span class="shelf-section-label">책장</span><div class="shelf-arrangement" role="group" aria-label="책장 정렬"><button type="button" data-action="shelf-arrangement" data-id="recent" aria-pressed="${this.arrangement === 'recent'}">최근순</button><button type="button" data-action="shelf-arrangement" data-id="folders" aria-pressed="${this.arrangement === 'folders'}">폴더순</button><button type="button" data-action="shelf-arrangement" data-id="custom" aria-pressed="${this.arrangement === 'custom'}">사용자 지정</button></div></div><div id="note-results" class="bookshelf"></div></section>
        </main>
      </div>
      <button class="phone-navigation-backdrop" type="button" data-action="close-phone-navigation" aria-label="메뉴 닫기" hidden></button>
      <nav class="phone-bottom-nav" aria-label="휴대폰 서재 탐색">
        <button type="button" data-action="filter" data-id="all" aria-label="전체 노트">${icon('Library', 21)}<span>노트</span></button>
        <button type="button" data-action="filter" data-id="recent" aria-label="최근 기록">${icon('Clock', 21)}<span>최근</span></button>
        <button type="button" data-action="filter" data-id="favorites" aria-label="즐겨찾는 노트">${icon('Star', 21)}<span>즐겨찾기</span></button>
        <button type="button" data-action="mobile-menu" aria-label="폴더 열기" aria-controls="phone-library-sidebar" aria-expanded="false">${icon('Folder', 21)}<span>폴더</span></button>
      </nav>
    </div>`;
    this.renderResults();
    this.phoneCleanup = bindPhoneLibrary(this.root);
  }
  private nav(id: string, name: Parameters<typeof icon>[0], label: string, count?: number, color?: string) {
    return `<button class="nav-item ${this.filter === id ? 'active' : ''}" data-action="filter" data-id="${id}"><span ${color ? `style="color:${safeColor(color)}"` : ''}>${icon(name)}</span><span>${escape(label)}</span>${count !== undefined ? `<small>${count}</small>` : ''}</button>`;
  }
  private profileInitial() { return Array.from(this.profile.name)[0] || 'N'; }
  private renderProfile(editing = false) {
    const popover = this.root.querySelector<HTMLElement>('.profile-popover')!;
    if (editing) {
      popover.innerHTML = `<form class="profile-form"><h2>프로필 수정</h2><label>이름<input name="name" autocomplete="name" maxlength="40" value="${escape(this.profile.name)}" /></label><label>학교<input name="school" autocomplete="organization" maxlength="80" value="${escape(this.profile.school)}" /></label><div class="profile-form-row"><label>학년<input name="grade" maxlength="20" value="${escape(this.profile.grade)}" /></label><label>반<input name="classroom" maxlength="20" value="${escape(this.profile.classroom)}" /></label></div><div class="profile-actions"><button type="button" class="button secondary" data-action="profile-cancel">취소</button><button type="submit" class="button primary">저장</button></div></form>`;
      popover.querySelector<HTMLInputElement>('[name=name]')?.focus();
      return;
    }
    const value = (text: string) => escape(text || '—');
    popover.innerHTML = `<h2>프로필</h2><div class="profile-summary"><span class="profile-summary-avatar">${escape(this.profileInitial())}</span><strong>${value(this.profile.name || '이름 없음')}</strong></div><dl class="profile-details"><div><dt>학교</dt><dd>${value(this.profile.school)}</dd></div><div><dt>학년</dt><dd>${value(this.profile.grade)}</dd></div><div><dt>반</dt><dd>${value(this.profile.classroom)}</dd></div></dl><button type="button" class="button secondary profile-edit" data-action="profile-edit">${icon('Pencil', 15)} 수정</button>`;
  }
  private closeProfile() {
    const popover = this.root.querySelector<HTMLElement>('.profile-popover');
    if (popover) popover.hidden = true;
    this.root.querySelector<HTMLButtonElement>('.avatar')?.setAttribute('aria-expanded', 'false');
  }
  private toggleProfile() {
    const popover = this.root.querySelector<HTMLElement>('.profile-popover')!;
    if (!popover.hidden) { this.closeProfile(); return; }
    this.renderProfile(); popover.hidden = false;
    this.root.querySelector<HTMLButtonElement>('.avatar')!.setAttribute('aria-expanded', 'true');
  }
  private submitProfile(event: Event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.classList.contains('profile-form')) return;
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    const profile = profileFrom(Object.fromEntries(new FormData(form)));
    run(async () => {
      submit.disabled = true;
      try {
        await db.settings.put({ key: 'user-profile', value: profile });
        this.profile = profile;
        this.root.querySelector<HTMLButtonElement>('.avatar')!.textContent = this.profileInitial();
        this.renderProfile();
        this.root.querySelector<HTMLButtonElement>('[data-action=profile-edit]')?.focus();
      } finally { submit.disabled = false; }
    });
  }
  private book(note: Note) {
    let hash = 2166136261;
    for (const char of note.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    hash >>>= 0;
    const width = 62 + hash % 24, height = 191 + (hash >>> 5) % 47;
    const material = ['cloth', 'linen', 'leather', 'paper'][hash % 4];
    const cover = safeColor(note.cover);
    const tone = ['#8fa7bb', '#9eae9c', '#b9a39d', '#a49faf', '#bea98d', '#8faeaa'][(hash >>> 9) % 6];
    return `<article class="book-slot ${this.selectedBook === note.id ? 'selected' : ''}" data-book-id="${note.id}" style="--spine-width:${width}px;--spine-height:${height}px;--book-color:${cover};--book-base:${tone};--book-grain:${hash % 37}px" title="${escape(note.title)} · ${note.pageIds.length}페이지 · ${formatDate(note.updated)}">
      <button class="book-spine note-open" type="button" data-action="open" data-id="${note.id}" aria-label="${escape(note.title)} 열기" aria-pressed="${this.selectedBook === note.id}" aria-description="한 번 누르면 선택, 다시 누르면 열립니다"><span class="book-cap" aria-hidden="true"></span><span class="book-brand" aria-hidden="true">N.</span><span class="book-title">${escape(note.title)}</span><span class="book-bottom" aria-hidden="true">${String(note.pageIds.length).padStart(2, '0')}</span><span class="book-pages" aria-hidden="true"></span><span class="book-material" data-material="${material}" aria-hidden="true"></span>${note.favorite ? `<span class="book-favorite" aria-label="즐겨찾기">${icon('Star', 12)}</span>` : ''}</button>
      ${this.arrangement === 'custom' ? `<button type="button" class="book-move" data-action="move-book" data-id="${note.id}" aria-label="${escape(note.title)} 자리 바꾸기" title="끌어서 자리 바꾸기 · 방향키로 이동">${icon('Move', 15)}</button>` : ''}
      <div class="book-tools"><button type="button" data-action="note-menu" data-id="${note.id}" aria-label="${escape(note.title)} 메뉴">${icon('MoreHorizontal', 17)}</button></div></article>`;
  }
  private shelf(index: number, notes: Note[], name?: string, folderId?: string) {
    return `<section class="bookshelf-compartment bookshelf-tier" data-tier="${index + 1}" ${folderId ? `data-folder="${escape(folderId)}"` : ''} aria-label="${name ? `${escape(name)} · ` : ''}책장 ${index + 1}단"><div class="shelf-well"><div class="shelf-books">${notes.map(note => this.book(note)).join('')}${!notes.length ? `<span class="shelf-empty">아직 꽂힌 노트가 없어요</span>` : ''}</div></div><div class="shelf-ledge">${name ? `<span class="shelf-floor-name">${escape(name)}<small>${notes.length}</small></span>` : ''}<span class="shelf-floor-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span></div></section>`;
  }
  private renderResults() {
    if (this.abort.signal.aborted) return;
    let notes = this.notes.filter(n => !n.deleted);
    notes = notes.filter(n => n.title.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()));
    notes.sort((a, b) => b.updated - a.updated);
    this.root.querySelector('#library-title')!.innerHTML = '나의 책장<span class="heading-dot">.</span>';
    const subtitle = this.root.querySelector<HTMLElement>('#library-subtitle')!;
    subtitle.textContent = `${notes.length}권의 노트 · ${this.arrangement === 'custom' ? '아래 이동 버튼을 끌어 책의 자리를 바꾸세요' : '책등을 한 번 눌러 선택하고 다시 눌러 펼치세요'}`;
    this.root.querySelector<HTMLElement>('.welcome-banner')!.hidden = !this.updateAvailable || !!this.query;
    const capacity = Math.max(4, Math.min(12, Math.floor((window.innerWidth - 155) / 80)));
    if (this.arrangement === 'folders') {
      const rank = new Map([...this.folders].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((folder, index) => [folder.id, index]));
      notes.sort((a, b) => (rank.get(a.folderId || '') ?? rank.size) - (rank.get(b.folderId || '') ?? rank.size) || b.updated - a.updated);
    } else if (this.arrangement === 'custom') {
      const rank = new Map(this.customOrder.map((id, index) => [id, index]));
      notes.sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size) || b.updated - a.updated);
    }
    this.visibleOrder = notes.map(note => note.id);
    const rows: string[] = [];
    for (let start = 0; start < notes.length; start += capacity) rows.push(this.shelf(rows.length, notes.slice(start, start + capacity)));
    this.root.querySelector('#note-results')!.innerHTML = rows.join('') || this.shelf(0, []);
    this.root.querySelector<HTMLElement>('#note-results')!.dataset.arrangement = this.arrangement;
    this.root.querySelectorAll<HTMLElement>('[data-action=shelf-arrangement]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === this.arrangement)));
    if (this.selectedBook && !notes.some(note => note.id === this.selectedBook)) this.selectedBook = null;
  }
  private click(event: Event) {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!target) { if ((event.target as Element).closest('.bookshelf')) this.selectBook(null); return; }
    const { action, id } = target.dataset;
    if (this.filter === 'trash' && ['new', 'import'].includes(action || '')) return;
    if (action === 'apply-update') run(this.applyUpdate);
    if (action === 'library-mode' && id === 'classic') run(() => this.changeMode('classic'));
    if (action === 'shelf-arrangement' && (id === 'recent' || id === 'folders' || id === 'custom')) {
      if (id === 'custom' && !this.customOrder.length) this.customOrder = [...this.visibleOrder];
      this.arrangement = id; this.selectBook(null); this.renderResults();
      run(async () => { await db.settings.bulkPut([{ key: 'bookshelf-arrangement', value: id }, { key: 'bookshelf-custom-order', value: this.customOrder }]); });
    }
    if (action === 'filter') { this.root.querySelector('.library-sidebar')?.classList.remove('mobile-open'); run(() => this.navigateFilter(id!)); }
    if (action === 'new') this.newNote();
    if (action === 'open') {
      if (this.movedPointer !== null) { this.movedPointer = null; return; }
      if (this.openingBook) return;
      if (this.selectedBook !== id) this.selectBook(id!);
      else run(() => this.openBook(target, id!));
    }
    if (action === 'new-folder') this.folderDialog();
    if (action === 'folder-menu') this.folderMenu(target, id!);
    if (action === 'note-menu') this.noteMenu(target, id!);
    if (action === 'move-book') this.moveBookMenu(target, id!);
    if (action === 'profile') this.toggleProfile();
    if (action === 'profile-edit') this.renderProfile(true);
    if (action === 'profile-cancel') this.renderProfile();
    if (action === 'settings') this.settings();
    if (action === 'import') run(async () => {
      const file = await pickFile('.pdf,application/pdf'); if (!file) return;
      toast('PDF를 가져오는 중이에요…');
      const note = await importPDF(file, this.folderId()); await this.openNote(note.id);
    });
    if (action === 'mobile-menu') this.root.querySelector('.library-sidebar')?.classList.toggle('mobile-open');
    if (action === 'close-phone-navigation') this.root.querySelector('.library-sidebar')?.classList.remove('mobile-open');
  }
  private selectBook(id: string | null) {
    this.selectedBook = id;
    this.root.querySelectorAll<HTMLElement>('.book-slot').forEach(book => {
      const selected = book.dataset.bookId === id;
      book.classList.toggle('selected', selected);
      book.querySelector('.book-spine')?.setAttribute('aria-pressed', String(selected));
    });
  }
  private moveBook(id: string, target: string, before: boolean) {
    const rank = new Map(this.customOrder.map((key, index) => [key, index]));
    const ordered = this.notes.filter(note => !note.deleted)
      .sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size) || b.updated - a.updated).map(note => note.id);
    const from = ordered.indexOf(id);
    if (from < 0 || id === target || !ordered.includes(target)) return;
    ordered.splice(from, 1);
    ordered.splice(ordered.indexOf(target) + (before ? 0 : 1), 0, id);
    this.customOrder = ordered; this.renderResults();
    [...this.root.querySelectorAll<HTMLButtonElement>('.book-move')].find(button => button.dataset.id === id)?.focus({ preventScroll: true });
    run(async () => { await db.settings.put({ key: 'bookshelf-custom-order', value: ordered }); });
  }
  private moveBookMenu(target: HTMLElement, id: string) {
    const index = this.visibleOrder.indexOf(id), items: Parameters<typeof contextMenu>[1] = [];
    if (index > 0) items.push({ label: '앞으로 한 칸', icon: 'ChevronLeft', action: () => this.moveBook(id, this.visibleOrder[index - 1], true) });
    if (index >= 0 && index < this.visibleOrder.length - 1) items.push({ label: '뒤로 한 칸', icon: 'ChevronRight', action: () => this.moveBook(id, this.visibleOrder[index + 1], false) });
    if (index > 0) items.push({ label: '맨 앞으로', icon: 'ArrowUp', action: () => this.moveBook(id, this.visibleOrder[0], true) });
    if (index < this.visibleOrder.length - 1) items.push({ label: '맨 뒤로', icon: 'ArrowDown', action: () => this.moveBook(id, this.visibleOrder.at(-1)!, false) });
    if (items.length) contextMenu(target, items);
  }
  private async openBook(source: HTMLElement, id: string) {
    const note = this.notes.find(item => item.id === id);
    if (!note) return;
    this.openingBook = true;
    const transition = beginBookOpening(this.root, source, note);
    try {
      await this.openNote(id);
      await transition.finish(this.root.querySelector<HTMLElement>('.paper-surface'));
    } catch (error) {
      transition.cancel();
      this.openingBook = false;
      throw error;
    }
  }
  private folderId() { return this.folders.some(f => f.id === this.filter) ? this.filter : null; }
  newNote() {
    const dialog = modal('새 노트', `<label class="form-label">노트 이름<input name="title" placeholder="노트 이름" value="제목 없는 노트" maxlength="100" required autofocus /></label><span class="form-label">표지 색상</span><div class="cover-options">${covers.map((c, i) => `<label style="--cover:${c}"><input type="radio" name="cover" value="${c}" ${i === 0 ? 'checked' : ''} aria-label="표지 색상 ${i + 1}" /><span>${icon('Check', 18)}</span></label>`).join('')}</div><span class="form-label">속지 선택</span><div class="paper-options">${Object.entries(paperNames).map(([p, label]) => `<label><input type="radio" name="paper" value="${p}" ${p === 'lined' ? 'checked' : ''}/><div class="paper-mini ${p}"></div><span>${label}</span></label>`).join('')}</div><div class="form-row"><label class="form-label">페이지 크기<select name="size"><option value="a4">A4</option><option value="a5">A5</option><option value="b5">B5</option></select></label><label class="form-label">방향<select name="orientation"><option value="portrait">세로</option><option value="landscape">가로</option></select></label><label class="form-label">종이 색<input name="paperColor" type="color" value="#fffefb" /></label></div>`, '노트 만들기', async data => {
      const size = ({ a4: [794, 1123], a5: [559, 794], b5: [665, 945] } as Record<string, number[]>)[String(data.get('size'))];
      const [width, height] = data.get('orientation') === 'landscape' ? [...size].reverse() : size;
      const { note, page } = createNote(String(data.get('title')).trim() || '제목 없는 노트', String(data.get('cover')), this.folderId(), { paper: data.get('paper') as Paper, paperColor: String(data.get('paperColor')), width, height });
      await persistNew(note, [page]); await this.openNote(note.id);
    });
    dialog.querySelector<HTMLInputElement>('[name=title]')!.select();
  }
  private folderDialog(folder?: Folder) {
    modal(folder ? '폴더 이름 변경' : '새 폴더', `<label class="form-label">폴더 이름<input name="name" value="${escape(folder?.name || '')}" placeholder="예: 이번 학기" required maxlength="60" autofocus /></label>`, folder ? '저장' : '폴더 만들기', async data => {
      const name = String(data.get('name')).trim(); if (!name) throw new Error('폴더 이름을 입력해 주세요.');
      await db.folders.put({ id: folder?.id || uid(), name, color: folder?.color || '#9eb5d2' }); await this.show();
    });
  }
  private folderMenu(target: HTMLElement, id: string) {
    const folder = this.folders.find(f => f.id === id)!;
    contextMenu(target, [
      { label: '이름 변경', icon: 'Pencil', action: () => this.folderDialog(folder) },
      { label: '폴더 삭제', icon: 'Trash2', danger: true, action: () => confirmAction('폴더를 삭제할까요?', '폴더 안의 노트는 모든 노트로 이동합니다.', '폴더 삭제', async () => {
        await db.transaction('rw', db.notes, db.folders, async () => { await db.notes.where('folderId').equals(id).modify({ folderId: null }); await db.folders.delete(id); });
        this.filter = 'all'; await this.show();
      }) }
    ]);
  }
  private noteMenu(target: HTMLElement, id: string) {
    const note = this.notes.find(n => n.id === id)!;
    if (note.deleted) return contextMenu(target, [
      { label: '노트 복구', icon: 'Undo2', action: () => run(async () => { await db.notes.update(id, { deleted: null }); await this.show(); toast('노트를 복구했어요.'); }) },
      { label: '영구 삭제', icon: 'Trash2', danger: true, action: () => confirmAction('영구 삭제할까요?', '이 노트와 첨부파일은 복구할 수 없습니다.', '영구 삭제', async () => { await deletePermanently(note); await this.show(); }) }
    ]);
    contextMenu(target, [
      { label: note.favorite ? '즐겨찾기 해제' : '즐겨찾기에 추가', icon: 'Star', action: () => run(async () => { await db.notes.update(id, { favorite: !note.favorite }); await this.show(); }) },
      { label: '이름 변경', icon: 'Pencil', action: () => modal('노트 이름 변경', `<label class="form-label">노트 이름<input name="title" required maxlength="100" value="${escape(note.title)}" /></label>`, '저장', async data => { await db.notes.update(id, { title: String(data.get('title')).trim() || note.title }); await this.show(); }) },
      { label: '폴더로 이동', icon: 'Folder', action: () => modal('폴더로 이동', `<label class="form-label">폴더<select name="folder"><option value="">모든 노트</option>${this.folders.map(f => `<option value="${f.id}" ${note.folderId === f.id ? 'selected' : ''}>${escape(f.name)}</option>`).join('')}</select></label>`, '이동', async data => { await db.notes.update(id, { folderId: String(data.get('folder')) || null }); await this.show(); }) },
      { label: '휴지통으로 이동', icon: 'Trash2', danger: true, action: () => confirmAction('휴지통으로 이동할까요?', '휴지통에서 언제든 다시 복구할 수 있어요.', '이동', async () => { await db.notes.update(id, { deleted: Date.now() }); await this.show(); }) }
    ]);
  }
  destroy() { this.phoneCleanup?.(); this.abort.abort(); }
}
