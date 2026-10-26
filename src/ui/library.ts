import { db, persistNew, deletePermanently } from '../data/store';
import { covers, createNote, paperNames, uid, type Folder, type Note, type Paper } from '../data/model';
import { importPDF, thumbnail } from '../data/pdf';
import { icon, button, escape, safeColor, modal, toast, run, pickFile, contextMenu, confirmAction, formatDate } from './common';
import { bindPhoneLibrary } from './phone-chrome';
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

export class LibraryView {
  private notes: Note[] = [];
  private folders: Folder[] = [];
  private filter = 'all';
  private query = '';
  private sort = 'updated';
  private list = false;
  private columns: 'auto' | 4 | 5 | 6 = 'auto';
  private abort = new AbortController();
  private previewVersion = 0;
  private updateAvailable = false;
  private updateApplying = false;
  private profile = emptyProfile();
  private phoneCleanup?: () => void;
  constructor(private root: HTMLElement, private openNote: (id: string) => Promise<void>, private settings: () => void,
    private navigateFilter: (filter: string) => Promise<void> = async filter => this.setFilter(filter), initial?: LibraryState,
    private applyUpdate: () => Promise<void> = async () => {}) {
    if (initial) { this.filter = initial.filter; this.query = initial.query; this.sort = initial.sort; this.list = initial.list; }
    root.addEventListener('click', e => this.click(e), { signal: this.abort.signal });
    root.addEventListener('input', e => {
      const el = e.target as HTMLInputElement;
      if (el.id === 'library-search') { this.query = el.value; this.renderResults(); }
    }, { signal: this.abort.signal });
    root.addEventListener('change', e => {
      const el = e.target as HTMLSelectElement;
      if (el.id === 'sort') { this.sort = el.value; this.renderResults(); }
      if (el.id === 'note-columns' && ['auto', '4', '5', '6'].includes(el.value)) {
        this.columns = el.value === 'auto' ? 'auto' : Number(el.value) as 4 | 5 | 6;
        this.list = false; this.renderResults();
        run(async () => { await db.settings.put({ key: 'library-columns', value: this.columns }); });
      }
    }, { signal: this.abort.signal });
    root.addEventListener('submit', e => this.submitProfile(e), { signal: this.abort.signal });
    document.addEventListener('pointerdown', e => {
      if (!(e.target instanceof Element) || !e.target.closest('.profile-anchor')) this.closeProfile();
    }, { signal: this.abort.signal });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.root.querySelector<HTMLElement>('.profile-popover:not([hidden])')) {
        e.preventDefault(); e.stopPropagation(); this.closeProfile(); this.root.querySelector<HTMLButtonElement>('.avatar')?.focus();
      }
    }, { signal: this.abort.signal });
  }
  async show() {
    const [notes, folders, columns, profile] = await Promise.all([db.notes.toArray(), db.folders.toArray(), db.settings.get('library-columns'), db.settings.get('user-profile')]);
    this.notes = notes.filter(note => !note.temporary); this.folders = folders;
    this.columns = [4, 5, 6].includes(columns?.value as number) ? columns!.value as 4 | 5 | 6 : 'auto';
    this.profile = profileFrom(profile?.value);
    this.render();
    void this.previews(++this.previewVersion);
  }
  setUpdateState(available: boolean, applying: boolean) {
    if (this.updateAvailable === available && this.updateApplying === applying) return;
    this.updateAvailable = available; this.updateApplying = applying;
    const banner = this.root.querySelector('.welcome-banner');
    if (banner) { banner.classList.toggle('update-banner', available); banner.innerHTML = this.bannerContent(); }
  }
  private bannerContent() {
    if (this.updateAvailable) return `<div role="status" aria-live="polite"><span class="banner-label"><span></span> 새 버전</span><h2>업데이트가 있어요.</h2><p>노트를 저장한 뒤 새 버전을 적용합니다.</p><button class="button primary banner-update-button" data-action="apply-update" ${this.updateApplying ? 'disabled' : ''}>${icon('RefreshCw', 17)} ${this.updateApplying ? '업데이트 적용 중…' : '지금 업데이트'}</button></div><div class="update-banner-art" aria-hidden="true">${icon('RefreshCw', 72)}<span>NOTELIN</span></div>`;
    return `<div><span class="banner-label"><span></span> A LITTLE SPACE, ENDLESS POSSIBILITIES</span><h2>오늘의 생각을 펼쳐보세요.</h2><p>펜 끝에서 시작되는 새로운 배움.<br>나만의 속도로, 한 페이지씩 채워가요.</p><button class="banner-link" data-action="new">새로운 페이지 시작하기 ${icon('ArrowUpRight', 17)}</button></div><div class="banner-art" aria-hidden="true"><div class="art-shadow"></div><div class="art-notebook back"></div><div class="art-notebook front"><span>small thoughts,<br>big possibilities.</span><i></i><small>NOTELIN / DAILY NOTES</small></div><div class="art-pen"></div><div class="art-star star-one">✧</div><div class="art-star star-two">✧</div><div class="art-dot"></div></div>`;
  }
  private async previews(version: number) {
    for (const note of this.notes.filter(n => !n.thumbnail && !n.deleted).slice(0, 12)) {
      if (this.abort.signal.aborted || version !== this.previewVersion) return;
      const page = await db.pages.get(note.pageIds[0]);
      if (page) try {
        const preview = await thumbnail(page);
        if (this.abort.signal.aborted || version !== this.previewVersion) return;
        const accepted = await db.transaction('rw', db.pages, db.notes, async () => {
          const latest = await db.pages.get(page.id); if (!latest || latest.revision !== page.revision) return false;
          await db.notes.update(note.id, { thumbnail: preview }); return true;
        });
        if (accepted) note.thumbnail = preview;
      } catch { /* Preview failure never blocks opening a note. */ }
    }
    if (!this.abort.signal.aborted && version === this.previewVersion) this.renderResults();
  }
  snapshot(): LibraryState { return { filter: this.filter, query: this.query, sort: this.sort, list: this.list }; }
  setFilter(filter: string) { this.filter = filter; this.renderResults(); }
  private render() {
    this.phoneCleanup?.();
    document.title = 'Notelin · 나의 서재';
    const active = this.notes.filter(n => !n.deleted);
    this.root.innerHTML = `<div class="library-shell">
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
        <header class="library-topbar"><div class="breadcrumb">${button('Menu', '메뉴 열기', 'mobile-menu')}<span>나의 공간</span>${icon('ChevronRight', 13)}<img class="phone-wordmark" src="${import.meta.env.BASE_URL}notelin-wordmark-lockup.png" alt="Notelin" /><strong id="breadcrumb-title">나의 서재</strong></div><div class="topbar-right"><div class="profile-anchor"><button class="avatar" type="button" data-action="profile" aria-label="프로필" aria-expanded="false" aria-controls="profile-popover">${escape(this.profileInitial())}</button><div class="profile-popover" id="profile-popover" role="dialog" aria-label="프로필" hidden></div></div></div></header>
        <main class="library-content">
          <div class="page-heading"><div><h1 id="library-title">나의 서재<span class="heading-dot">.</span></h1><p id="library-subtitle" hidden></p></div><div class="heading-actions"><button class="button secondary" data-action="import">${icon('Upload', 18)} PDF 가져오기</button><button class="button primary" data-action="new">${icon('Plus', 19)} 새 노트</button></div></div>
          <section class="welcome-banner ${this.updateAvailable ? 'update-banner' : ''}">${this.bannerContent()}</section>
          <section class="recent-section"><div class="section-heading"><h2>${icon('Clock', 18)} 최근 펼쳐본 노트</h2><button class="text-button" data-action="filter" data-id="recent">모두 보기 ${icon('ChevronRight', 15)}</button></div><div id="recent-notes" class="recent-grid"></div></section>
          <section class="notes-section"><div class="collection-toolbar"><div class="collection-tabs"><button class="collection-tab active" data-action="filter" data-id="all">모든 노트 <span>${active.length}</span></button><button class="collection-tab" data-action="filter" data-id="favorites">즐겨찾기 ${icon('Star', 14)}</button></div><div class="collection-controls"><label class="search-field">${icon('Search', 17)}<input id="library-search" type="search" placeholder="노트 검색" aria-label="노트 검색" value="${escape(this.query)}" /></label><label class="sort-field"><select id="sort" aria-label="노트 정렬"><option value="updated">최근 수정순</option><option value="name">이름순</option><option value="created">최근 생성순</option></select>${icon('ChevronDown', 13)}</label><label class="note-density">한 줄<select id="note-columns" aria-label="한 줄 노트 개수"><option value="auto">자동</option><option value="4">4개</option><option value="5">5개</option><option value="6">6개</option></select></label><div class="view-toggle">${button('Grid2X2', '그리드 보기', 'grid')}${button('List', '목록 보기', 'list')}</div></div></div><div id="note-results"></div></section>
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
    this.root.querySelector<HTMLSelectElement>('#sort')!.value = this.sort;
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
  private card(note: Note) {
    const cover = safeColor(note.cover);
    const channels = [1, 3, 5].map(i => parseInt(cover.slice(i, i + 2), 16) / 255);
    const light = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    const coverInk = light > .67 ? '#25416b' : '#ffffff';
    return `<article class="note-card"><button class="note-open" data-action="open" data-id="${note.id}" aria-label="${escape(note.title)} 열기"><div class="notebook-cover" style="--cover:${cover};--cover-ink:${coverInk}"><div class="cover-spine"></div><span class="cover-brand">NOTELIN</span><div class="cover-title">${escape(note.title)}</div><div class="cover-preview">${note.thumbnail ? `<img src="${note.thumbnail}" alt="첫 페이지 미리보기" loading="lazy" />` : `<div class="preview-lines"></div>`}</div></div></button><div class="note-info"><div><button class="note-title" data-action="open" data-id="${note.id}">${escape(note.title)}</button><span>${note.pageIds.length}페이지 <i>·</i> ${note.deleted ? '휴지통' : formatDate(note.updated)}</span></div><button class="note-menu icon-button" data-action="note-menu" data-id="${note.id}" aria-label="${escape(note.title)} 메뉴">${icon('MoreHorizontal', 19)}</button></div>${note.favorite ? `<span class="note-star">${icon('Star', 13)}</span>` : ''}</article>`;
  }
  private renderResults() {
    if (this.abort.signal.aborted) return;
    const active = this.notes.filter(n => !n.deleted);
    let notes = this.notes.filter(n => this.filter === 'trash' ? !!n.deleted : !n.deleted);
    if (this.filter === 'favorites') notes = notes.filter(n => n.favorite);
    if (!['all', 'recent', 'favorites', 'trash'].includes(this.filter)) notes = notes.filter(n => n.folderId === this.filter);
    notes = notes.filter(n => n.title.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()));
    notes.sort((a, b) => this.sort === 'name' ? a.title.localeCompare(b.title, 'ko') : this.filter === 'recent' ? b.opened - a.opened : this.sort === 'created' ? b.created - a.created : b.updated - a.updated);
    const title = ({ all: '나의 서재', recent: '최근 사용한 노트', favorites: '즐겨찾기', trash: '휴지통' } as Record<string, string>)[this.filter] || this.folders.find(f => f.id === this.filter)?.name || '나의 서재';
    this.root.querySelector('#library-title')!.innerHTML = `${escape(title)}<span class="heading-dot">.</span>`;
    this.root.querySelector('#breadcrumb-title')!.textContent = title;
    const subtitle = this.root.querySelector<HTMLElement>('#library-subtitle')!;
    subtitle.hidden = this.filter !== 'trash';
    subtitle.textContent = this.filter === 'trash' ? '영구 삭제하기 전까지 복구할 수 있어요.' : '';
    this.root.querySelector<HTMLElement>('.heading-actions')!.hidden = this.filter === 'trash';
    this.root.querySelectorAll<HTMLElement>('.welcome-banner,.recent-section').forEach(e => e.hidden = this.filter !== 'all' || !!this.query);
    this.root.querySelectorAll('.nav-item[data-id],.collection-tab').forEach(e => e.classList.toggle('active', (e as HTMLElement).dataset.id === this.filter));
    this.root.querySelectorAll<HTMLElement>('.phone-bottom-nav [data-action=filter]').forEach(button => {
      const active = button.dataset.id === this.filter;
      button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    const recent = [...active].sort((a, b) => b.opened - a.opened).slice(0, 3);
    this.root.querySelector('#recent-notes')!.innerHTML = recent.map(n => `<button class="recent-note" data-action="open" data-id="${n.id}"><div class="recent-cover" style="--cover:${safeColor(n.cover)}">${icon('BookOpen', 23)}</div><div><strong>${escape(n.title)}</strong><span>${formatDate(n.opened)}에 열었어요</span></div>${icon('ChevronRight', 16)}</button>`).join('') || '<p class="muted">최근 사용한 노트가 없어요.</p>';
    const cards = notes.map(n => this.card(n)).join('');
    const gridSetting = this.columns === 'auto' ? '' : `data-columns="${this.columns}" style="--note-columns:${this.columns}"`;
    this.root.querySelector<HTMLSelectElement>('#note-columns')!.value = String(this.columns);
    this.root.querySelector('#note-results')!.innerHTML = `<div class="notes-grid ${this.list ? 'list-view' : ''}" ${gridSetting}>${cards}</div>${!notes.length ? `<div class="empty-state">${icon(this.filter === 'trash' ? 'Trash2' : 'BookOpen', 40)}<h3>${this.query ? '검색 결과가 없어요' : '아직 노트가 없어요'}</h3></div>` : ''}`;
    this.root.querySelectorAll('.view-toggle button').forEach(e => e.classList.toggle('active', (e as HTMLElement).dataset.action === (this.list ? 'list' : 'grid')));
  }
  private click(event: Event) {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]'); if (!target) return;
    const { action, id } = target.dataset;
    if (this.filter === 'trash' && ['new', 'import'].includes(action || '')) return;
    if (action === 'apply-update') run(this.applyUpdate);
    if (action === 'filter') { this.root.querySelector('.library-sidebar')?.classList.remove('mobile-open'); run(() => this.navigateFilter(id!)); }
    if (action === 'new') this.newNote();
    if (action === 'open') run(() => this.openNote(id!));
    if (action === 'new-folder') this.folderDialog();
    if (action === 'folder-menu') this.folderMenu(target, id!);
    if (action === 'note-menu') this.noteMenu(target, id!);
    if (action === 'grid' || action === 'list') { this.list = action === 'list'; this.renderResults(); }
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
