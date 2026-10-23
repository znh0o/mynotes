import { db, persistNew, deletePermanently } from '../data/store';
import { covers, createNote, paperNames, uid, type Folder, type Note, type Paper } from '../data/model';
import { importPDF, thumbnail } from '../data/pdf';
import { icon, button, escape, safeColor, modal, toast, run, pickFile, contextMenu, confirmAction, formatDate } from './common';
import { bindToolTaps } from './tool-taps';
export interface LibraryState { filter: string; query: string; sort: string; list: boolean }

export class LibraryView {
  private notes: Note[] = [];
  private folders: Folder[] = [];
  private filter = 'all';
  private query = '';
  private sort = 'updated';
  private list = false;
  private abort = new AbortController();
  private previewVersion = 0;
  constructor(private root: HTMLElement, private openNote: (id: string) => Promise<void>, private settings: () => void,
    private navigateFilter: (filter: string) => Promise<void> = async filter => this.setFilter(filter), initial?: LibraryState) {
    if (initial) { this.filter = initial.filter; this.query = initial.query; this.sort = initial.sort; this.list = initial.list; }
    bindToolTaps(root, e => this.click(e), this.abort.signal);
    root.addEventListener('click', e => this.click(e), { signal: this.abort.signal });
    root.addEventListener('input', e => {
      const el = e.target as HTMLInputElement;
      if (el.id === 'library-search') { this.query = el.value; this.renderResults(); }
    }, { signal: this.abort.signal });
    root.addEventListener('change', e => { const el = e.target as HTMLSelectElement; if (el.id === 'sort') { this.sort = el.value; this.renderResults(); } }, { signal: this.abort.signal });
  }
  async show() {
    this.notes = await db.notes.toArray(); this.folders = await db.folders.toArray();
    this.render();
    void this.previews(++this.previewVersion);
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
    document.title = 'MyNotes · 나의 서재';
    const active = this.notes.filter(n => !n.deleted);
    this.root.innerHTML = `<div class="library-shell">
      <aside class="library-sidebar">
        <button class="brand" data-action="filter" data-id="all" aria-label="MyNotes 홈"><span class="brand-mark">${icon('PenLine', 24)}</span>MyNotes<span class="brand-dot">.</span></button>
        <div class="workspace-label">나만의 작은 서재</div>
        <nav aria-label="서재 탐색">
          ${this.nav('all', 'Library', '모든 노트', active.length)}
          ${this.nav('recent', 'Clock', '최근 사용한 노트')}
          ${this.nav('favorites', 'Star', '즐겨찾기', active.filter(n => n.favorite).length)}
        </nav>
        <div class="sidebar-section-title">내 폴더 ${button('Plus', '새 폴더', 'new-folder')}</div>
        <nav class="folder-nav" aria-label="내 폴더">${this.folders.length ? this.folders.map(f => `<div class="folder-row">${this.nav(f.id, 'Folder', f.name, active.filter(n => n.folderId === f.id).length, f.color)}${button('MoreHorizontal', `${f.name} 관리`, `folder-menu`, `data-id="${f.id}"`)}</div>`).join('') : '<p class="sidebar-empty">주제별로 생각을 모아보세요.</p>'}</nav>
        <button class="add-folder" data-action="new-folder">${icon('FolderPlus', 17)} 새 폴더 만들기</button>
        <div class="sidebar-bottom">
          ${this.nav('trash', 'Trash2', '휴지통', this.notes.filter(n => n.deleted).length)}
          <button class="nav-item" data-action="settings">${icon('Settings2')}<span>설정 및 백업</span></button>
          <div class="device-note"><span class="status-dot"></span><div>이 기기에 안전하게 저장<span>오프라인에서도 이어서 쓰세요</span></div>${icon('HardDrive', 17)}</div>
        </div>
      </aside>
      <div class="library-main">
        <header class="library-topbar"><div class="breadcrumb">${button('Menu', '메뉴 열기', 'mobile-menu')}<span>나의 공간</span>${icon('ChevronRight', 13)}<strong id="breadcrumb-title">나의 서재</strong></div><div class="topbar-right"><span class="local-badge">${icon('ShieldCheck', 15)} 오프라인 우선</span><button class="avatar" data-action="settings" aria-label="내 기기 설정">M</button></div></header>
        <main class="library-content">
          <div class="page-heading"><div><span class="eyebrow">YOUR SPACE TO THINK</span><h1 id="library-title">나의 서재<span class="heading-dot">.</span></h1><p id="library-subtitle">작은 아이디어부터 깊은 배움까지, 모두 이곳에.</p></div><div class="heading-actions"><button class="button secondary" data-action="import">${icon('Upload', 18)} PDF 가져오기</button><button class="button primary" data-action="new">${icon('Plus', 19)} 새 노트</button></div></div>
          <section class="welcome-banner"><div><span class="banner-label"><span></span> A LITTLE SPACE, ENDLESS POSSIBILITIES</span><h2>오늘의 생각을 펼쳐보세요.</h2><p>펜 끝에서 시작되는 새로운 배움.<br>나만의 속도로, 한 페이지씩 채워가요.</p><button class="banner-link" data-action="new">새로운 페이지 시작하기 ${icon('ArrowUpRight', 17)}</button></div><div class="banner-art" aria-hidden="true"><div class="art-shadow"></div><div class="art-notebook back"></div><div class="art-notebook front"><span>small thoughts,<br>big possibilities.</span><i></i><small>MYNOTES / DAILY NOTES</small></div><div class="art-pen"></div><div class="art-star star-one">✧</div><div class="art-star star-two">✧</div><div class="art-dot"></div></div></section>
          <section class="recent-section"><div class="section-heading"><h2>${icon('Clock', 18)} 최근 펼쳐본 노트</h2><button class="text-button" data-action="filter" data-id="recent">모두 보기 ${icon('ChevronRight', 15)}</button></div><div id="recent-notes" class="recent-grid"></div></section>
          <section class="notes-section"><div class="collection-toolbar"><div class="collection-tabs"><button class="collection-tab active" data-action="filter" data-id="all">모든 노트 <span>${active.length}</span></button><button class="collection-tab" data-action="filter" data-id="favorites">즐겨찾기 ${icon('Star', 14)}</button></div><div class="collection-controls"><label class="search-field">${icon('Search', 17)}<input id="library-search" type="search" placeholder="노트 검색" aria-label="노트 검색" value="${escape(this.query)}" /></label><label class="sort-field"><select id="sort" aria-label="노트 정렬"><option value="updated">최근 수정순</option><option value="name">이름순</option><option value="created">최근 생성순</option></select>${icon('ChevronDown', 13)}</label><div class="view-toggle">${button('Grid2X2', '그리드 보기', 'grid')}${button('List', '목록 보기', 'list')}</div></div></div><div id="note-results"></div></section>
          <section class="template-section"><div class="section-heading"><div><span class="eyebrow">START WITH A FRESH PAGE</span><h2>생각에 맞는 한 장</h2></div><span class="muted">어떤 이야기를 써볼까요?</span></div><div class="template-grid">${(['blank', 'lined', 'grid', 'cornell'] as Paper[]).map((p, i) => `<button class="template-card" data-action="template" data-id="${p}"><div class="paper-mini ${p}"><span>${['Aa', '오늘의 기록', 'x + y =', 'IDEA / NOTE'][i]}</span></div><div><strong>${paperNames[p]}</strong><span>${['자유롭게 펼치는 아이디어', '차곡차곡 쌓이는 기록', '정리할수록 선명한 생각', '배움을 나만의 언어로'][i]}</span></div>${icon('ArrowUpRight', 16)}</button>`).join('')}</div></section>
          <footer class="library-footer"><span>Made for your thoughts.</span><span>${icon('Check', 13)} 로그인 없이 · 이 기기에 저장</span></footer>
        </main>
      </div>
    </div>`;
    this.root.querySelector<HTMLSelectElement>('#sort')!.value = this.sort;
    this.renderResults();
  }
  private nav(id: string, name: Parameters<typeof icon>[0], label: string, count?: number, color?: string) {
    return `<button class="nav-item ${this.filter === id ? 'active' : ''}" data-action="filter" data-id="${id}"><span ${color ? `style="color:${safeColor(color)}"` : ''}>${icon(name)}</span><span>${escape(label)}</span>${count !== undefined ? `<small>${count}</small>` : ''}</button>`;
  }
  private card(note: Note) {
    const cover = safeColor(note.cover);
    const channels = [1, 3, 5].map(i => parseInt(cover.slice(i, i + 2), 16) / 255);
    const light = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    const coverInk = light > .67 ? '#25416b' : '#ffffff';
    return `<article class="note-card"><button class="note-open" data-action="open" data-id="${note.id}" aria-label="${escape(note.title)} 열기"><div class="notebook-cover" style="--cover:${cover};--cover-ink:${coverInk}"><div class="cover-spine"></div><span class="cover-brand">MYNOTES</span><div class="cover-title">${escape(note.title)}</div><div class="cover-preview">${note.thumbnail ? `<img src="${note.thumbnail}" alt="첫 페이지 미리보기" loading="lazy" />` : `<div class="preview-lines"></div>`}</div><span class="cover-edition">PERSONAL COLLECTION <i>01</i></span></div></button><div class="note-info"><div><button class="note-title" data-action="open" data-id="${note.id}">${escape(note.title)}</button><span>${note.pageIds.length}페이지 <i>·</i> ${note.deleted ? '휴지통' : formatDate(note.updated)}</span></div><button class="note-menu icon-button" data-action="note-menu" data-id="${note.id}" aria-label="${escape(note.title)} 메뉴">${icon('MoreHorizontal', 19)}</button></div>${note.favorite ? `<span class="note-star">${icon('Star', 13)}</span>` : ''}</article>`;
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
    this.root.querySelector('#library-subtitle')!.textContent = this.filter === 'trash' ? '삭제한 노트는 영구 삭제하기 전까지 복구할 수 있어요.' : '작은 아이디어부터 깊은 배움까지, 모두 이곳에.';
    this.root.querySelectorAll<HTMLElement>('.welcome-banner,.recent-section,.template-section').forEach(e => e.hidden = this.filter !== 'all' || !!this.query);
    this.root.querySelectorAll('.nav-item[data-id],.collection-tab').forEach(e => e.classList.toggle('active', (e as HTMLElement).dataset.id === this.filter));
    const recent = [...active].sort((a, b) => b.opened - a.opened).slice(0, 3);
    this.root.querySelector('#recent-notes')!.innerHTML = recent.map(n => `<button class="recent-note" data-action="open" data-id="${n.id}"><div class="recent-cover" style="--cover:${safeColor(n.cover)}">${icon('BookOpen', 23)}</div><div><strong>${escape(n.title)}</strong><span>${formatDate(n.opened)}에 열었어요</span></div>${icon('ChevronRight', 16)}</button>`).join('') || '<p class="muted">새 노트를 펼쳐 이야기를 시작해 보세요.</p>';
    this.root.querySelector('#note-results')!.innerHTML = `<div class="notes-grid ${this.list ? 'list-view' : ''}">${this.filter === 'all' && !this.query ? `<button class="new-note-tile" data-action="new"><span>${icon('Plus', 26)}</span><strong>새로운 생각 담기</strong><small>나만의 노트를 만들어보세요</small></button>` : ''}${notes.map(n => this.card(n)).join('')}</div>${!notes.length && (this.filter !== 'all' || this.query) ? `<div class="empty-state">${icon(this.filter === 'trash' ? 'Trash2' : 'BookOpen', 40)}<h3>${this.query ? '검색 결과가 없어요' : '아직 노트가 없어요'}</h3><p>${this.filter === 'trash' ? '삭제한 노트가 이곳에 모여요.' : '새 노트에 첫 생각을 남겨보세요.'}</p></div>` : ''}`;
    this.root.querySelectorAll('.view-toggle button').forEach(e => e.classList.toggle('active', (e as HTMLElement).dataset.action === (this.list ? 'list' : 'grid')));
  }
  private click(event: Event) {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]'); if (!target) return;
    const { action, id } = target.dataset;
    if (action === 'filter') { this.root.querySelector('.library-sidebar')?.classList.remove('mobile-open'); run(() => this.navigateFilter(id!)); }
    if (action === 'new' || action === 'template') this.newNote(action === 'template' ? id as Paper : 'lined');
    if (action === 'open') run(() => this.openNote(id!));
    if (action === 'new-folder') this.folderDialog();
    if (action === 'folder-menu') this.folderMenu(target, id!);
    if (action === 'note-menu') this.noteMenu(target, id!);
    if (action === 'grid' || action === 'list') { this.list = action === 'list'; this.renderResults(); }
    if (action === 'settings') this.settings();
    if (action === 'import') run(async () => {
      const file = await pickFile('.pdf,application/pdf'); if (!file) return;
      toast('PDF를 가져오는 중이에요…');
      const note = await importPDF(file, this.folderId()); await this.openNote(note.id);
    });
    if (action === 'mobile-menu') this.root.querySelector('.library-sidebar')?.classList.toggle('mobile-open');
  }
  private folderId() { return this.folders.some(f => f.id === this.filter) ? this.filter : null; }
  newNote(paper: Paper = 'lined') {
    const dialog = modal('새로운 노트', `<p class="dialog-description">첫 페이지를, 당신의 취향으로.</p><label class="form-label">노트 이름<input name="title" placeholder="예: 나의 생각 노트" value="제목 없는 노트" maxlength="100" required autofocus /></label><span class="form-label">표지 색상</span><div class="cover-options">${covers.map((c, i) => `<label style="--cover:${c}"><input type="radio" name="cover" value="${c}" ${i === 0 ? 'checked' : ''} aria-label="표지 색상 ${i + 1}" /><span>${icon('Check', 18)}</span></label>`).join('')}</div><span class="form-label">속지 선택</span><div class="paper-options">${Object.entries(paperNames).map(([p, label]) => `<label><input type="radio" name="paper" value="${p}" ${p === paper ? 'checked' : ''}/><div class="paper-mini ${p}"></div><span>${label}</span></label>`).join('')}</div><div class="form-row"><label class="form-label">페이지 크기<select name="size"><option value="a4">A4</option><option value="a5">A5</option><option value="b5">B5</option></select></label><label class="form-label">방향<select name="orientation"><option value="portrait">세로</option><option value="landscape">가로</option></select></label><label class="form-label">종이 색<input name="paperColor" type="color" value="#fffefb" /></label></div>`, '노트 만들기', async data => {
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
  destroy() { this.abort.abort(); }
}
