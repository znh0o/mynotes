import { db, SaveQueue } from '../data/store';
import { newPage, paperNames, uid, type Item, type Note, type Page, type Paper, type Point, type Tool } from '../data/model';
import { background, exportPDF, loadImages, thumbnail } from '../data/pdf';
import { InkEngine } from '../engine/InkEngine';
import { button, contextMenu, escape, icon, modal, pickFile, report, run, toast, confirmAction } from './common';
import { bindToolTaps } from './tool-taps';
import { isAppReloadApproved } from '../pwa/navigation';
import { PagePreviews } from './page-previews';
import { trackDialog } from './history';

export class EditorView {
  private engine!: InkEngine;
  private page!: Page;
  private index = 0;
  private scale = .8;
  private queue: SaveQueue;
  private thumbTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeObserver!: ResizeObserver;
  private abort = new AbortController();
  private generation = 0;
  private switching = false;
  private fit = true;
  private touches = new Map<number, {x: number; y: number}>();
  private pinch: { distance: number; scale: number; x: number; y: number; scrollX: number; scrollY: number; centerX: number; centerY: number } | null = null;
  private pan: { id: number; x: number; y: number; left: number; top: number } | null = null;
  private viewport!: HTMLElement;
  private widthPointer: number | null = null;
  private viewportFrame = 0;
  private viewportUpdate: (() => void) | null = null;
  private zoomTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingScale: number | null = null;
  private previews!: PagePreviews;
  private toolHint = '볼펜 · 힘을 줘도 굵기가 일정한 선';
  constructor(private root: HTMLElement, public note: Note,
    private tabs: { id: string; title: string }[], private open: (id: string) => Promise<void>,
    private home: () => Promise<void>, private closeTab: (id: string) => Promise<void>, private settings: () => void) {
    this.queue = new SaveQueue(db, state => {
      const el = this.root.querySelector<HTMLElement>('#save-status');
      if (el) { el.innerHTML = `${icon(state.startsWith('저장 실패') ? 'WifiOff' : 'Check', 13)} ${escape(state)}`; el.classList.toggle('save-error', state.startsWith('저장 실패')); }
    });
  }
  async start() {
    document.title = `${this.note.title} · MyNotes`;
    this.root.innerHTML = `<div class="editor-shell">
      <header class="editor-header"><button class="editor-home" data-action="home" aria-label="서재로 돌아가기">${icon('ChevronLeft', 19)}<span class="brand-mark small">${icon('PenLine', 18)}</span><span>서재</span></button><div class="open-tabs">${this.tabs.map(t => `<div class="note-tab ${t.id === this.note.id ? 'active' : ''}"><button data-action="tab" data-id="${t.id}">${icon('BookOpen', 15)}<span>${escape(t.title)}</span></button><button data-action="close-tab" data-id="${t.id}" aria-label="${escape(t.title)} 탭 닫기">${icon('X', 13)}</button></div>`).join('')}</div><div class="editor-header-actions"><button class="save-indicator" id="save-status" data-action="save" title="지금 저장">${icon('Check', 13)} 모든 변경사항 저장됨</button>${button('Search', '노트 내 텍스트 검색', 'search')}${button('Download', 'PDF 내보내기', 'export')}${button('Maximize', '전체 화면', 'fullscreen')}${button('MoreHorizontal', '노트 설정', 'settings')}</div></header>
      <div class="ink-toolbar" role="toolbar" aria-label="필기 도구"><div class="toolbar-tools"><div class="tool-group editor-utility">${button('PanelLeft', '페이지 목록', 'sidebar')}<span class="toolbar-separator"></span>${button('Undo2', '실행 취소 (Ctrl+Z)', 'undo', 'disabled')}${button('Redo2', '다시 실행 (Ctrl+Shift+Z)', 'redo', 'disabled')}</div><div class="tool-group drawing-tools">${([['pen', 'PenLine', '볼펜'], ['fountain', 'Feather', '만년필'], ['pencil', 'Pencil', '연필'], ['highlighter', 'Highlighter', '형광펜'], ['eraser', 'Eraser', '지우개'], ['lasso', 'Lasso', '올가미'], ['shape', 'Shapes', '도형'], ['text', 'Type', '텍스트'], ['image', 'Image', '이미지'], ['hand', 'Hand', '이동']] as const).map(([tool, i, label]) => `<button class="tool-button ${tool === 'pen' ? 'active' : ''}" data-action="tool" data-id="${tool}" aria-label="${label}" aria-pressed="${tool === 'pen'}" title="${label}">${icon(i, 22)}<span>${label}</span></button>`).join('')}</div></div><div class="ink-style-controls"><div class="color-palette">${['#30445e', '#5e85bd', '#cf7d85', '#83a58a', '#e5c360'].map((c, n) => `<button class="color-swatch ${n === 0 ? 'active' : ''}" style="--color:${c}" data-action="color" data-id="${c}" title="${['잉크', '블루', '로즈', '세이지', '옐로'][n]}" aria-label="${['잉크', '블루', '로즈', '세이지', '옐로'][n]}"></button>`).join('')}<label class="custom-color" title="사용자 색상">${icon('Plus', 15)}<input type="color" id="ink-color" value="#30445e" aria-label="사용자 색상" /></label></div><div class="pen-width-control"><label for="ink-width">굵기</label><span id="width-preview" aria-hidden="true"></span><button type="button" data-action="pen-thinner" aria-label="펜 굵기 줄이기" title="펜 굵기 줄이기">${icon('Minus', 15)}</button><input id="ink-width" type="range" min="0.5" max="20" step="0.5" value="3" aria-label="펜 굵기" /><button type="button" data-action="pen-thicker" aria-label="펜 굵기 늘리기" title="펜 굵기 늘리기">${icon('Plus', 15)}</button><output id="width-value" for="ink-width">3.0</output></div></div><div class="editor-options">${button('Settings2', '필기 옵션', 'writing-options', 'aria-haspopup="dialog" aria-expanded="false" aria-controls="writing-options-panel"')}</div></div>
      <div class="editor-body"><aside class="page-sidebar"><div class="page-sidebar-heading"><strong>페이지</strong><span>${this.note.pageIds.length}</span>${button('Plus', '페이지 추가', 'add-page')}</div><div id="page-thumbnails"></div><button class="add-page-button" data-action="add-page">${icon('Plus', 17)} 페이지 추가</button></aside>
        <main class="paper-viewport" aria-label="필기 작업 공간"><div class="paper-stage"><div class="paper-sizing"><div class="paper-surface"><canvas id="paper-background" aria-hidden="true"></canvas><canvas id="paper-ink" aria-hidden="true"></canvas><canvas id="paper-live" aria-label="필기 캔버스"></canvas></div></div></div><div class="page-loading" hidden>페이지를 불러오는 중…</div></main>
      </div><footer class="editor-footer"><div><span class="status-dot"></span><span id="paper-description">A4 · 줄노트</span><span class="footer-divider"></span><span>S펜 필압 지원</span></div><div class="page-navigation">${button('ChevronLeft', '이전 페이지', 'prev-page')}<button class="page-position" data-action="goto-page">1 / ${this.note.pageIds.length}</button>${button('ChevronRight', '다음 페이지', 'next-page')}</div><div class="zoom-controls">${button('Minus', '축소', 'zoom-out')}<button id="zoom-value" data-action="fit">80%</button>${button('Plus', '확대', 'zoom-in')}<button class="text-button" data-action="fit">화면에 맞춤</button></div></footer>
      <div class="selection-toolbar" hidden><span id="selection-count"></span>${button('Copy', '선택 복사', 'selection-copy')}${button('Plus', '선택 확대', 'selection-grow')}${button('Minus', '선택 축소', 'selection-shrink')}${button('Trash2', '선택 삭제', 'selection-delete')}${button('X', '선택 해제', 'deselect')}</div>
    </div>`;
    this.viewport = this.root.querySelector('.paper-viewport')!;
    this.engine = new InkEngine(this.root.querySelector('#paper-ink')!, this.root.querySelector('#paper-live')!, () => this.changed(), count => {
      this.root.querySelector<HTMLElement>('.selection-toolbar')!.hidden = !count;
      this.root.querySelector('#selection-count')!.textContent = `${count}개 선택 · 드래그로 이동`;
    }, (p, tool) => this.insert(p, tool));
    this.previews = new PagePreviews(this.root.querySelector('#page-thumbnails')!, this.root.querySelector('.page-sidebar')!,
      () => this.engine.activePointer !== null || this.viewport.classList.contains('zoom-preview'),
      (id, preview, revision) => { if (this.page?.id === id && this.page.revision === revision) this.page.thumbnail = preview; });
    bindToolTaps(this.root, e => this.click(e), this.abort.signal);
    this.setWidth(this.engine.options.width);
    const widthSlider = this.root.querySelector<HTMLInputElement>('#ink-width')!;
    const widthFromPointer = (e: PointerEvent) => {
      const rect = widthSlider.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left - 10) / Math.max(1, rect.width - 20)));
      this.setWidth(.5 + fraction * 19.5);
    };
    widthSlider.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.widthPointer !== null) return;
      e.preventDefault(); widthSlider.focus({ preventScroll: true });
      this.widthPointer = e.pointerId; widthSlider.setPointerCapture(e.pointerId); widthFromPointer(e);
    }, { signal: this.abort.signal });
    widthSlider.addEventListener('pointermove', e => {
      if (this.widthPointer !== e.pointerId) return;
      e.preventDefault(); widthFromPointer(e);
    }, { signal: this.abort.signal });
    widthSlider.addEventListener('pointerup', e => {
      if (this.widthPointer !== e.pointerId) return;
      widthFromPointer(e); this.widthPointer = null;
      if (widthSlider.hasPointerCapture(e.pointerId)) widthSlider.releasePointerCapture(e.pointerId);
    }, { signal: this.abort.signal });
    widthSlider.addEventListener('pointercancel', () => this.widthPointer = null, { signal: this.abort.signal });
    widthSlider.addEventListener('lostpointercapture', () => this.widthPointer = null, { signal: this.abort.signal });
    this.root.addEventListener('click', e => this.click(e), { signal: this.abort.signal });
    this.root.addEventListener('input', e => this.input(e), { signal: this.abort.signal });
    this.root.addEventListener('change', e => {
      if ((e.target as HTMLElement).id === 'ink-width') this.input(e);
    }, { signal: this.abort.signal });
    document.addEventListener('keydown', e => this.keyboard(e), { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) run(() => this.flush()); }, { signal: this.abort.signal });
    window.addEventListener('beforeunload', e => { if (!isAppReloadApproved()) { e.preventDefault(); e.returnValue = ''; } }, { signal: this.abort.signal });
    this.setupGestures();
    await this.showPage(0);
    this.resizeObserver = new ResizeObserver(() => { if (this.fit && this.page) this.setScale(this.fitScale(), true); });
    this.resizeObserver.observe(this.viewport);
  }
  private fitScale() { return Math.min(1.35, Math.max(.2, (this.viewport.clientWidth - 100) / this.page.width)); }
  async showPage(index: number) {
    if (index < 0 || index >= this.note.pageIds.length || this.switching) return;
    this.switching = true;
    this.cancelViewportUpdate();
    const loading = this.root.querySelector<HTMLElement>('.page-loading')!; loading.hidden = false;
    let failed = false;
    loading.classList.remove('page-load-error'); loading.textContent = '페이지를 불러오는 중…';
    try {
      if (this.page) { this.engine.cancel(); await this.flush(); }
      const page = await db.pages.get(this.note.pageIds[index]); if (!page) throw new Error('페이지를 찾을 수 없어요.');
      await loadImages(page); this.index = index; this.page = page;
      this.engine.load(page); this.setScale(this.fit ? this.fitScale() : this.scale, this.fit);
      this.viewport.scrollTo({ left: 0, top: 0 });
      this.root.querySelector('.page-position')!.textContent = `${index + 1} / ${this.note.pageIds.length}`;
      this.root.querySelector('#paper-description')!.textContent = page.pdfAssetId ? 'PDF · 원본 위에 필기' : `${Math.round(page.width)} × ${Math.round(page.height)} · ${paperNames[page.paper]}`;
      await this.renderBackground(); await this.renderThumbnails(); this.updateHistory();
      this.root.querySelector<HTMLButtonElement>('[data-action=prev-page]')!.disabled = index === 0;
      this.root.querySelector<HTMLButtonElement>('[data-action=next-page]')!.disabled = index === this.note.pageIds.length - 1;
    } catch (error) {
      failed = true;
      loading.classList.add('page-load-error');
      loading.innerHTML = `<div><h2>페이지를 표시하지 못했어요</h2><p>${escape(error instanceof Error ? error.message : '페이지를 다시 열어 주세요.')}</p><div><button class="button secondary" data-action="retry-page">다시 시도</button><button class="button primary" data-action="home">서재로 돌아가기</button></div></div>`;
      console.warn('Page rendering failed; notebook data is preserved.', error);
    } finally { this.switching = false; loading.hidden = !failed; }
  }
  private async renderBackground() {
    const generation = ++this.generation, p = this.page, temp = document.createElement('canvas');
    const ratio = Math.min(Math.max(1, this.scale * devicePixelRatio), Math.sqrt(10000000 / (p.width * p.height)));
    await background(temp, p, ratio);
    if (generation !== this.generation || this.abort.signal.aborted) return;
    const canvas = this.root.querySelector<HTMLCanvasElement>('#paper-background')!;
    canvas.width = temp.width; canvas.height = temp.height; canvas.getContext('2d')!.drawImage(temp, 0, 0);
  }
  private async renderThumbnails() {
    const rows = await db.pages.bulkGet(this.note.pageIds);
    if (this.abort.signal.aborted) return;
    this.root.querySelector('#page-thumbnails')!.innerHTML = rows.map((p, i) => p ? `<div class="page-thumb-row ${i === this.index ? 'active' : ''}"><button class="page-thumb" data-action="page" data-id="${i}" data-page-id="${p.id}" aria-label="${i + 1}페이지"><div class="page-thumb-paper ${p.paper}" style="aspect-ratio:${p.width}/${p.height}">${p.thumbnail ? `<img src="${p.thumbnail}" alt="${i + 1}페이지 미리보기"/>` : `<span>${p.pdfAssetId ? 'PDF' : paperNames[p.paper]}</span>`}</div><span>${i + 1}</span></button>${button('MoreHorizontal', `${i + 1}페이지 메뉴`, 'page-menu', `data-id="${i}"`)}</div>` : '').join('');
    this.root.querySelector('.page-sidebar-heading > span')!.textContent = String(this.note.pageIds.length);
    this.previews.observe(rows);
  }
  private changed() {
    this.updateHistory();
    const page = this.page;
    page.thumbnail = undefined;
    void this.queue.saveImmutable(page).catch(report);
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => run(() => this.saveThumbnail(page)), 1400);
  }
  private async saveThumbnail(page: Page) {
    if (this.engine.activePointer !== null || this.viewport.classList.contains('zoom-preview')) {
      this.thumbTimer = setTimeout(() => run(() => this.saveThumbnail(page)), 500); return;
    }
    const revision = page.revision, snapshot = { ...page, items: page.items.slice() }, thumb = await thumbnail(snapshot);
    if (page.revision !== revision) return;
    page.thumbnail = thumb; await this.queue.saveImmutable(page, thumb);
    if (page.id === this.page.id && !this.abort.signal.aborted) await this.renderThumbnails();
  }
  async flush() {
    clearTimeout(this.thumbTimer);
    // Navigation and PWA updates depend only on durable data. PDF rendering is
    // optional presentation work and must never prevent leaving the editor.
    if (this.page) { await this.queue.saveImmutable(this.page); await this.queue.flush(); }
  }
  private updateHistory() {
    this.root.querySelector<HTMLButtonElement>('[data-action=undo]')!.disabled = !this.engine.canUndo;
    this.root.querySelector<HTMLButtonElement>('[data-action=redo]')!.disabled = !this.engine.canRedo;
  }
  private setScale(scale: number, fit = false, rasterize = true) {
    this.scale = Math.max(.2, Math.min(4, scale)); this.fit = fit;
    const size = this.root.querySelector<HTMLElement>('.paper-sizing')!;
    size.style.width = `${this.page.width * this.scale}px`; size.style.height = `${this.page.height * this.scale}px`;
    this.root.querySelector('#zoom-value')!.textContent = `${Math.round(this.scale * 100)}%`;
    if (rasterize) this.engine.resize();
  }
  private zoom(scale: number) {
    this.cancelViewportUpdate();
    this.engine.cancel(); this.setScale(scale); run(() => this.renderBackground());
  }
  private queueViewportUpdate(update: () => void) {
    this.viewportUpdate = update;
    if (this.viewportFrame) return;
    this.viewportFrame = requestAnimationFrame(() => {
      this.viewportFrame = 0; const latest = this.viewportUpdate; this.viewportUpdate = null; latest?.();
    });
  }
  private cancelViewportUpdate() {
    clearTimeout(this.zoomTimer); cancelAnimationFrame(this.viewportFrame);
    this.viewportFrame = 0; this.viewportUpdate = null; this.pendingScale = null;
    this.viewport?.classList.remove('zoom-preview');
  }
  private finishViewportUpdate() {
    clearTimeout(this.zoomTimer); this.zoomTimer = undefined;
    cancelAnimationFrame(this.viewportFrame); this.viewportFrame = 0;
    const latest = this.viewportUpdate; this.viewportUpdate = null; latest?.(); this.pendingScale = null;
    this.engine.resize(); this.viewport.classList.remove('zoom-preview');
    run(() => this.renderBackground());
  }
  private click(e: Event) {
    const target = (e.target as Element).closest<HTMLElement>('[data-action]'); if (!target) return;
    const { action, id } = target.dataset;
    if (action === 'home') run(this.home);
    if (action === 'retry-page') run(() => this.showPage(this.index));
    if (action === 'tab' && id !== this.note.id) run(() => this.open(id!));
    if (action === 'close-tab') run(() => this.closeTab(id!));
    if (action === 'tool') this.selectTool(id as Tool);
    if (action === 'color') this.setColor(id!);
    if (action === 'pen-thinner') this.setWidth(this.engine.options.width - .5);
    if (action === 'pen-thicker') this.setWidth(this.engine.options.width + .5);
    if (action === 'undo') this.engine.undo();
    if (action === 'redo') this.engine.redo();
    if (action === 'sidebar') { this.root.querySelector('.page-sidebar')!.classList.toggle('collapsed'); if (this.fit) this.setScale(this.fitScale(), true); }
    if (action === 'zoom-in') this.zoom(this.scale * 1.2);
    if (action === 'zoom-out') this.zoom(this.scale / 1.2);
    if (action === 'fit') { this.setScale(this.fitScale(), true); run(() => this.renderBackground()); }
    if (action === 'page') run(() => this.showPage(Number(id)));
    if (action === 'prev-page') run(() => this.showPage(this.index - 1));
    if (action === 'next-page') run(() => this.showPage(this.index + 1));
    if (action === 'add-page') run(() => this.addPage());
    if (action === 'page-menu') this.pageMenu(target, Number(id));
    if (action === 'writing-options') {
      const panel = document.createElement('dialog'); panel.className = 'writing-options-panel'; panel.id = 'writing-options-panel'; panel.setAttribute('aria-label', '필기 옵션');
      panel.innerHTML = `<div class="writing-options-heading"><strong>필기 옵션</strong>${button('X', '필기 옵션 닫기', 'close-writing-options')}</div><p id="tool-hint">${escape(this.toolHint)}</p><div id="context-options">${this.contextOptions()}</div><label class="finger-switch"><input id="finger-drawing" type="checkbox" ${this.engine.options.fingerDrawing ? 'checked' : ''}/><span></span>손가락 필기</label><button class="text-button" data-action="paper">${icon('LayoutTemplate', 15)} 속지 설정</button>`;
      this.root.querySelector('.editor-options')!.append(panel);
      panel.style.top = `${this.root.querySelector('.ink-toolbar')!.getBoundingClientRect().bottom + 8}px`;
      panel.addEventListener('close', () => { panel.remove(); target.setAttribute('aria-expanded', 'false'); }, { once: true });
      panel.addEventListener('click', event => {
        if (event.target !== panel) return;
        const rect = panel.getBoundingClientRect(), pointer = event as MouseEvent;
        if (pointer.clientX < rect.left || pointer.clientX > rect.right || pointer.clientY < rect.top || pointer.clientY > rect.bottom) panel.close();
      });
      panel.showModal(); trackDialog(panel); target.setAttribute('aria-expanded', 'true');
    }
    if (action === 'close-writing-options') this.root.querySelector<HTMLDialogElement>('#writing-options-panel')!.close();
    if (action === 'paper') {
      const panel = this.root.querySelector<HTMLDialogElement>('#writing-options-panel');
      // Let the options dialog release its history entry before opening paper
      // settings, so closing both never leaves an extra invisible Back step.
      if (panel?.open) { panel.addEventListener('close', () => this.paperSettings(), { once: true }); panel.close(); }
      else this.paperSettings();
    }
    if (action === 'fullscreen') run(async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await this.root.requestFullscreen(); });
    if (action === 'search') this.search();
    if (action === 'settings') this.settings();
    if (action === 'save') run(async () => { await this.flush(); await this.saveThumbnail(this.page); toast('저장했어요.'); });
    if (action === 'goto-page') modal('페이지 이동', `<label class="form-label">페이지 번호<input type="number" name="page" min="1" max="${this.note.pageIds.length}" value="${this.index + 1}" required /></label>`, '이동', async data => { await this.showPage(Number(data.get('page')) - 1); });
    if (action === 'export') run(async () => {
      await this.flush(); target.setAttribute('disabled', '');
      try { toast('PDF 내보내기를 준비하고 있어요…'); await exportPDF(this.note, (n, total) => toast(`PDF 생성 중 ${n} / ${total}`)); toast('PDF를 내보냈어요.'); }
      finally { target.removeAttribute('disabled'); }
    });
    if (action?.startsWith('selection-')) { this.engine.selectionAction(action.slice(10)); if (action === 'selection-copy') toast('선택을 복사했어요. Ctrl+V로 붙여넣으세요.'); }
    if (action === 'deselect') this.engine.clearSelection();
  }
  private input(e: Event) {
    const el = e.target as HTMLInputElement;
    if (el.id === 'ink-color') this.setColor(el.value);
    if (el.id === 'ink-width') this.setWidth(Number(el.value));
    if (el.id === 'finger-drawing') { this.engine.options.fingerDrawing = el.checked; toast(el.checked ? '손가락으로도 필기할 수 있어요.' : '손가락은 이동, S펜은 필기에 사용해요.'); }
    if (el.id === 'eraser-size') this.engine.options.eraserSize = Number(el.value);
    if (el.id === 'eraser-mode') this.engine.options.partialEraser = el.value === 'partial';
    if (el.id === 'shape-type') this.engine.options.shape = el.value as 'rect';
  }
  private setColor(color: string) {
    this.engine.options.color = color;
    this.root.querySelector<HTMLElement>('#width-preview')!.style.backgroundColor = color;
    this.root.querySelectorAll<HTMLElement>('[data-action=color]').forEach(e => e.classList.toggle('active', e.dataset.id === color));
    this.root.querySelector<HTMLInputElement>('#ink-color')!.value = color;
  }
  private setWidth(value: number) {
    if (!Number.isFinite(value)) return;
    const width = Math.max(.5, Math.min(20, Math.round(value * 2) / 2));
    this.engine.options.width = width;
    const slider = this.root.querySelector<HTMLInputElement>('#ink-width')!;
    slider.value = String(width);
    slider.setAttribute('aria-valuetext', width.toFixed(1));
    slider.style.setProperty('--width-progress', `${(width - .5) / 19.5 * 100}%`);
    this.root.querySelector<HTMLOutputElement>('#width-value')!.value = width.toFixed(1);
    this.root.querySelector<HTMLElement>('#width-preview')!.style.height = `${Math.min(16, width)}px`;
    this.root.querySelector<HTMLButtonElement>('[data-action=pen-thinner]')!.disabled = width === .5;
    this.root.querySelector<HTMLButtonElement>('[data-action=pen-thicker]')!.disabled = width === 20;
  }
  private selectTool(tool: Tool) {
    this.engine.cancel(); this.engine.clearSelection(); this.engine.options.tool = tool;
    this.root.querySelectorAll<HTMLElement>('[data-action=tool]').forEach(e => { const active = e.dataset.id === tool; e.classList.toggle('active', active); e.setAttribute('aria-pressed', String(active)); });
    this.viewport.classList.toggle('hand-mode', tool === 'hand');
    const hints: Record<Tool, string> = { pen: '볼펜 · 힘을 줘도 굵기가 일정한 선', fountain: '만년필 · 필압과 펜촉 방향에 따라 달라지는 굵기', pencil: '연필 · 종이의 입자감, 필압에 따른 진하기', highlighter: '형광펜 · 중요한 부분을 선명하게', eraser: '지우개 · S펜 버튼도 지우개로 사용할 수 있어요', lasso: '올가미 · 둘러싸서 선택한 다음 드래그로 이동', shape: '도형 · 드래그로 반듯한 도형 그리기', text: '텍스트 · 종이를 눌러 글상자 추가', image: '이미지 · 종이를 눌러 이미지 추가', hand: '이동 · 드래그로 종이 이동, 두 손가락으로 확대' };
    this.toolHint = hints[tool];
  }
  private contextOptions() {
    const tool = this.engine.options.tool;
    return tool === 'eraser' ? `<select id="eraser-mode" aria-label="지우개 모드"><option value="stroke" ${!this.engine.options.partialEraser ? 'selected' : ''}>획 전체</option><option value="partial" ${this.engine.options.partialEraser ? 'selected' : ''}>부분 지우기</option></select><input id="eraser-size" type="range" min="8" max="100" value="${this.engine.options.eraserSize}" aria-label="지우개 크기"/>` : tool === 'shape' ? `<select id="shape-type" aria-label="도형 종류">${[['rect', '사각형'], ['ellipse', '원'], ['line', '직선'], ['triangle', '삼각형']].map(([v, t]) => `<option value="${v}" ${this.engine.options.shape === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : tool === 'pen' ? '<p>볼펜은 필압과 관계없이 설정한 굵기를 유지해요.</p>' : tool === 'lasso' ? `<button class="text-button" data-action="selection-paste">${icon('Copy', 14)} 붙여넣기</button>` : '';
  }
  private insert(point: Point, tool: Tool) {
    const page = this.page;
    if (tool === 'text') {
      modal('텍스트 추가', `<label class="form-label">내용<textarea name="text" rows="5" required autofocus placeholder="생각을 글로 남겨보세요"></textarea></label><label class="form-label">글자 크기<input type="number" name="size" min="10" max="100" value="22" required /></label>`, '추가', data => {
        if (this.page !== page) return;
        const size = Number(data.get('size')), text = String(data.get('text'));
        this.engine.mutate(() => page.items.push({ id: uid(), kind: 'text', x: point.x, y: point.y, w: Math.max(...text.split('\n').map(t => t.length)) * size, h: text.split('\n').length * size * 1.55, color: this.engine.options.color, size, text }));
      });
    } else run(async () => {
      const file = await pickFile('image/png,image/jpeg,image/webp'); if (!file) return;
      if (file.size > 20 * 1024 * 1024) throw new Error('이미지는 20MB 이하로 추가해 주세요.');
      const img = new Image(), url = URL.createObjectURL(file);
      try {
        img.src = url; await img.decode();
        if (img.width * img.height > 40000000) throw new Error('이미지 해상도가 너무 커요. 크기를 줄여 주세요.');
        const id = uid(); await db.assets.add({ id, noteId: this.note.id, blob: file, name: file.name });
        if (this.page !== page) return;
        const w = Math.min(img.width, page.width * .65), h = w * img.height / img.width;
        const item: Item = { id: uid(), kind: 'image', assetId: id, x: point.x, y: point.y, w, h };
        page.items.push(item); await loadImages(page); page.items.pop(); this.engine.mutate(() => page.items.push(item));
      } finally { URL.revokeObjectURL(url); }
    });
  }
  private async addPage(source?: Page) {
    await this.flush();
    const p = source ? { ...structuredClone(source), id: uid(), items: source.items.map(i => ({ ...structuredClone(i), id: uid() })) } : newPage(this.note.id, { width: this.page.width, height: this.page.height, paper: this.page.paper, paperColor: this.page.paperColor, spacing: this.page.spacing });
    const ids = [...this.note.pageIds]; ids.splice(this.index + 1, 0, p.id);
    await db.transaction('rw', db.pages, db.notes, async () => { await db.pages.add(p); await db.notes.update(this.note.id, { pageIds: ids, updated: Date.now() }); });
    this.note.pageIds = ids; await this.showPage(this.index + 1); toast(source ? '페이지를 복제했어요.' : '새 페이지를 추가했어요.');
  }
  private pageMenu(target: HTMLElement, index: number) {
    contextMenu(target, [
      { label: '페이지 복제', icon: 'Copy', action: () => run(async () => { await this.showPage(index); await this.addPage(this.page); }) },
      { label: '앞으로 이동', icon: 'ArrowUp', action: () => run(() => this.reorder(index, -1)) },
      { label: '뒤로 이동', icon: 'ArrowDown', action: () => run(() => this.reorder(index, 1)) },
      { label: '페이지 삭제', icon: 'Trash2', danger: true, action: () => {
        if (this.note.pageIds.length < 2) return toast('최소 한 페이지는 남겨두어야 해요.');
        confirmAction('페이지를 삭제할까요?', '이 페이지의 필기가 삭제됩니다. 노트 전체 백업에서만 복원할 수 있어요.', '삭제', async () => {
          await this.flush(); const id = this.note.pageIds[index], ids = this.note.pageIds.filter(p => p !== id);
          await db.transaction('rw', db.pages, db.notes, async () => { await db.pages.delete(id); await db.notes.update(this.note.id, { pageIds: ids, updated: Date.now(), thumbnail: undefined }); });
          this.note.pageIds = ids; this.page = undefined as unknown as Page;
          await this.showPage(Math.min(this.index, ids.length - 1));
        });
      } }
    ]);
  }
  private async reorder(index: number, step: number) {
    if (index + step < 0 || index + step >= this.note.pageIds.length) return;
    await this.flush(); const currentId = this.page.id, ids = [...this.note.pageIds];
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    await db.notes.update(this.note.id, { pageIds: ids, thumbnail: undefined, updated: Date.now() }); this.note.pageIds = ids;
    await this.showPage(ids.indexOf(currentId));
  }
  private paperSettings() {
    if (this.page.pdfAssetId) return toast('PDF 페이지의 배경은 원본을 사용해요. 새 페이지에는 속지를 설정할 수 있어요.');
    modal('속지 설정', `<label class="form-label">속지<select name="paper">${Object.entries(paperNames).map(([p, label]) => `<option value="${p}" ${this.page.paper === p ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="form-row"><label class="form-label">종이 색<input name="color" type="color" value="${this.page.paperColor}" /></label><label class="form-label">줄 간격<input name="spacing" type="number" min="12" max="80" value="${this.page.spacing}" required /></label></div>`, '적용', async data => {
      this.page.paper = data.get('paper') as Paper; this.page.paperColor = String(data.get('color')); this.page.spacing = Number(data.get('spacing')); this.page.revision++;
      this.changed(); await this.renderBackground(); this.root.querySelector('#paper-description')!.textContent = paperNames[this.page.paper];
    });
  }
  private search() {
    const dialog = modal('노트 내 검색', `<label class="form-label">검색어<input name="query" type="search" placeholder="텍스트 및 PDF 내용 검색" required autofocus /></label><p class="muted">직접 입력한 텍스트를 검색합니다. 손글씨 인식과 PDF 본문 검색은 아직 지원하지 않습니다.</p><div id="search-results"></div>`, '검색', async (data) => {
      const query = String(data.get('query')).toLocaleLowerCase(), pages = await db.pages.bulkGet(this.note.pageIds);
      const matches = pages.flatMap((p, i) => p?.items.filter(v => v.kind === 'text' && v.text.toLocaleLowerCase().includes(query)).map(v => ({ i, text: v.kind === 'text' ? v.text : '' })) || []);
      // Keep this dialog open after the search; selecting a result navigates.
      if (!matches.length) { toast('검색 결과가 없어요.'); return; }
      await this.showPage(matches[0].i); toast(`${matches.length}개 결과 · 첫 결과가 있는 ${matches[0].i + 1}페이지로 이동했어요.`);
    });
    dialog.querySelector<HTMLInputElement>('[name=query]')!.placeholder = '입력한 텍스트 검색';
  }
  private keyboard(e: KeyboardEvent) {
    if (e.key === 'F5' || (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault(); toast('필기 화면에서는 새로고침을 막았어요. 서재로 돌아가거나 설정에서 업데이트해 주세요.'); return;
    }
    if ((e.target as Element).matches('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.engine.redo() : this.engine.undo(); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.engine.redo(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); run(() => this.flush()); }
    if (mod && e.key.toLowerCase() === 'c' && this.engine.selected.size) { e.preventDefault(); this.engine.selectionAction('copy'); toast('선택을 복사했어요.'); }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); this.engine.selectionAction('paste'); }
    if (e.key === 'Delete' || e.key === 'Backspace') this.engine.selectionAction('delete');
    if (e.key === 'Escape') this.engine.clearSelection();
    if (!mod && e.key.toLowerCase() === 'p') this.selectTool('pen');
    if (!mod && e.key.toLowerCase() === 'e') this.selectTool('eraser');
    if (!mod && e.key.toLowerCase() === 'h') this.selectTool('hand');
  }
  private setupGestures() {
    const signal = this.abort.signal;
    this.viewport.addEventListener('pointerdown', e => {
      if (e.pointerType === 'pen' && this.engine.options.tool !== 'hand') return;
      if (e.pointerType === 'touch') {
        if (this.engine.activePointer !== null && !this.engine.options.fingerDrawing) return;
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size === 2) {
          this.cancelViewportUpdate(); this.viewport.classList.add('zoom-preview');
          this.engine.cancel(); const [a, b] = [...this.touches.values()], r = this.viewport.getBoundingClientRect();
          this.pinch = { distance: Math.hypot(b.x - a.x, b.y - a.y), scale: this.scale, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
            scrollX: this.viewport.scrollLeft, scrollY: this.viewport.scrollTop, centerX: (a.x + b.x) / 2 - r.left, centerY: (a.y + b.y) / 2 - r.top };
          this.pan = null;
        }
        // A deliberate two-finger pinch is allowed after lifting the pen;
        // one-finger palm contacts during the brief pen hover window stay ignored.
        if (this.touches.size === 1 && this.engine.lastPen > 0 && performance.now() - this.engine.lastPen < 800) return;
      }
      if ((e.pointerType === 'touch' && !this.engine.options.fingerDrawing && this.touches.size === 1) || this.engine.options.tool === 'hand') {
        this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.viewport.scrollLeft, top: this.viewport.scrollTop };
        this.viewport.setPointerCapture(e.pointerId);
      }
    }, { signal });
    this.viewport.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.touches.size === 2) {
        const [a, b] = [...this.touches.values()], p = this.pinch;
        this.queueViewportUpdate(() => {
          this.setScale(p.scale * Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, p.distance), false, false);
          const ratio = this.scale / p.scale;
          this.viewport.scrollLeft = (p.scrollX + p.centerX) * ratio - p.centerX - ((a.x + b.x) / 2 - p.x);
          this.viewport.scrollTop = (p.scrollY + p.centerY) * ratio - p.centerY - ((a.y + b.y) / 2 - p.y);
        });
      } else if (this.pan?.id === e.pointerId) {
        this.viewport.scrollLeft = this.pan.left - (e.clientX - this.pan.x); this.viewport.scrollTop = this.pan.top - (e.clientY - this.pan.y);
      }
    }, { signal });
    const end = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2 && this.pinch) { this.pinch = null; this.finishViewportUpdate(); }
      if (this.pan?.id === e.pointerId) this.pan = null;
    };
    this.viewport.addEventListener('pointerup', end, { signal }); this.viewport.addEventListener('pointercancel', end, { signal });
    this.viewport.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (!this.viewport.classList.contains('zoom-preview')) this.engine.cancel();
        this.viewport.classList.add('zoom-preview');
        this.pendingScale = Math.max(.2, Math.min(4, (this.pendingScale ?? this.scale) * Math.exp(-e.deltaY * .002)));
        const target = this.pendingScale;
        this.queueViewportUpdate(() => this.setScale(target, false, false));
        clearTimeout(this.zoomTimer); this.zoomTimer = setTimeout(() => this.finishViewportUpdate(), 140);
      }
      // At page boundaries a normal wheel gesture can continue to the adjacent page.
      else if (Math.abs(e.deltaY) > 45 && !this.switching) {
        const bottom = this.viewport.scrollTop + this.viewport.clientHeight >= this.viewport.scrollHeight - 2;
        if (bottom && e.deltaY > 0 && this.index < this.note.pageIds.length - 1) run(() => this.showPage(this.index + 1));
      }
    }, { signal, passive: false });
  }
  destroy() { this.previews?.destroy(); this.cancelViewportUpdate(); clearTimeout(this.thumbTimer); this.generation++; this.engine?.destroy(); this.abort.abort(); this.resizeObserver?.disconnect(); }
}
