import { db, SaveQueue } from '../data/store';
import { newPage, paperNames, uid, type Item, type Note, type Page, type Paper, type Point, type Shape, type TextItem, type Tool } from '../data/model';
import { documentFrame, splitDocument, textFont } from '../engine/text';
import { background, exportPDF, loadImages, thumbnail } from '../data/pdf';
import { InkEngine } from '../engine/InkEngine';
import { button, contextMenu, escape, icon, modal, pickFile, report, run, toast, confirmAction } from './common';
import { isAppReloadApproved } from '../pwa/navigation';
import { PagePreviews } from './page-previews';
import { DetailRenderer } from './detail-renderer';
import { PalmRejection } from '../engine/PalmRejection';
import { trackDialog } from './history';
import { InlineTextEditor } from './inline-text';
import { showPenCheck } from './pen-check';
import { openColorPicker } from './color-picker';
import { paintPenPreviews, penPreview } from './pen-preview';
import { brushKey, brushProfile, inkTools, isInkTool, type BrushProfile, type InkTool } from '../data/brush-settings';
import { defaultPenCollection, duplicatePen, isPenKind, penKinds, penNames, type PenCollection, type PenKind, type PenPreset } from '../data/pen-presets';
import { loadSharedPens, sharedPensKey } from '../data/shared-pens';
import { bindPhoneEditor } from './phone-chrome';
import { StudyTimer } from './study-timer';
import { closeNativeStudyPanel, isNativeApp, openNativeStudyBrowser, openNativeStudyAI, setNativeStudyPanelOccluded, studyAIProvider, studyAILabel, type StudyAIProvider } from '../platform/native';

const shapeChoices: { id: Shape; name: string; drawing: string }[] = [
  { id: 'rect', name: '사각형', drawing: '<rect x="8" y="11" width="40" height="30" rx="2" />' },
  { id: 'ellipse', name: '원 · 타원', drawing: '<ellipse cx="28" cy="26" rx="20" ry="15" />' },
  { id: 'line', name: '직선', drawing: '<path d="M9 39 47 13" />' },
  { id: 'triangle', name: '삼각형', drawing: '<path d="M28 10 48 42H8Z" />' },
];
const shapeIcon = (shape: Shape, size: number) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 56 52" fill="none" stroke="currentColor" stroke-width="${size <= 24 ? 4.8 : 2.7}" stroke-linecap="round" stroke-linejoin="round">${shapeChoices.find(choice => choice.id === shape)!.drawing}</svg>`;

export class EditorView {
  private engine!: InkEngine;
  private companionEngine!: InkEngine;
  private editingEngine!: InkEngine;
  private page!: Page;
  private index = 0;
  private scale = .8;
  private queue: SaveQueue;
  private thumbTimer: ReturnType<typeof setTimeout> | undefined;
  private companionThumbTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeObserver!: ResizeObserver;
  private abort = new AbortController();
  private generation = 0;
  private switching = false;
  private fit = true;
  private twoPage = false;
  private spreadPage?: Page;
  private spreadGeneration = 0;
  private palette = ['#30445e', '#5e85bd', '#cf7d85', '#83a58a', '#e5c360'];
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
  private detail!: DetailRenderer;
  private companionDetail!: DetailRenderer;
  private palmGuard = new PalmRejection();
  private toolHint = '볼펜 · 힘을 줘도 굵기가 일정한 선';
  private inkAdjustment: 'width' | 'darkness' = 'width';
  private previousInkTool: Tool = 'pen';
  private brushes = Object.fromEntries(inkTools.map(tool => [tool, brushProfile(tool)])) as Record<InkTool, BrushProfile>;
  private pens: PenCollection = defaultPenCollection({ pen: brushProfile('pen'), fountain: brushProfile('fountain'), pencil: brushProfile('pencil') });
  private penTimer?: ReturnType<typeof setTimeout>;
  private penDirty = false;
  private penWrites = Promise.resolve();
  private pageSelectionWrites = Promise.resolve();
  private penDraft?: PenPreset;
  private dirtyBrushes = new Set<InkTool>();
  private brushTimer?: ReturnType<typeof setTimeout>;
  private brushWrites = Promise.resolve();
  private textEditor!: InlineTextEditor;
  private studyPanel: 'browser' | 'ai' | null = null;
  private aiProvider: StudyAIProvider = 'chatgpt';
  private studyPanelOccluded = false;
  private studyBrowserObserver?: MutationObserver;
  private temporaryNoticeTimer?: ReturnType<typeof setTimeout>;
  private studyTimer?: StudyTimer;
  constructor(private root: HTMLElement, public note: Note,
    private tabs: { id: string; title: string }[], private open: (id: string) => Promise<void>,
    private home: () => Promise<void>, private closeTab: (id: string) => Promise<void>) {
    this.queue = new SaveQueue(db, state => {
      const el = this.root.querySelector<HTMLElement>('#save-status');
      if (el) { el.innerHTML = `${icon(state.startsWith('저장 실패') ? 'WifiOff' : 'Check', 13)} ${escape(state)}`; el.title = `${state} · 지금 저장`; el.classList.toggle('save-error', state.startsWith('저장 실패')); }
    });
  }
  async start() {
    const [pencilSetting, lineSetting, eraserSetting, penButtonSetting, spreadSetting, paletteSetting, shapeSetting, aiSetting, textColorSetting, ...brushSettings] = await db.settings.bulkGet([
      'pencil-darkness', 'hold-to-line', 'eraser-settings', 'samsung-pen-button-toggle', 'two-page-view', `note-palette:${this.note.id}`, `note-shape:${this.note.id}`, 'study-ai-provider', `note-text-color:${this.note.id}`,
      ...inkTools.map(brushKey), ...inkTools.map(tool => `note-brush:${this.note.id}:${tool}`),
    ]);
    inkTools.forEach((tool, index) => this.brushes[tool] = brushProfile(tool, brushSettings[index + inkTools.length]?.value ?? brushSettings[index]?.value, pencilSetting?.value));
    this.pens = await loadSharedPens(this.note.id, defaultPenCollection(this.brushes));
    this.aiProvider = studyAIProvider(aiSetting?.value);
    this.twoPage = spreadSetting?.value === true;
    if (Array.isArray(paletteSetting?.value) && paletteSetting.value.length === 5 && paletteSetting.value.every((color: unknown) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) this.palette = paletteSetting.value;
    document.title = `${this.note.title} · Notelin`;
    this.root.innerHTML = `<div class="editor-shell">
      <header class="editor-header"><button class="editor-home" data-action="home" aria-label="서재로 돌아가기">${icon('ChevronLeft', 19)}<span class="brand-mark small">${icon('PenLine', 18)}</span><span>서재</span></button><div class="open-tabs">${this.tabs.map(t => `<div class="note-tab ${t.id === this.note.id ? 'active' : ''}"><button data-action="tab" data-id="${t.id}">${icon('BookOpen', 15)}<span>${escape(t.title)}</span></button><button data-action="close-tab" data-id="${t.id}" aria-label="${escape(t.title)} 탭 닫기">${icon('X', 13)}</button></div>`).join('')}</div><div class="editor-page-controls">${button('ChevronLeft', '이전 페이지', 'prev-page')}<button class="page-position" data-action="goto-page">1 / ${this.note.pageIds.length}</button>${button('ChevronRight', '다음 페이지', 'next-page')}</div><div class="editor-header-actions"><button class="save-indicator" id="save-status" data-action="save" title="지금 저장">${icon('Check', 13)} 모든 변경사항 저장됨</button>${button('Search', '노트 내 텍스트 검색', 'search')}${button('Download', 'PDF 내보내기', 'export')}${button('BookOpen', '보기 옵션', 'view-options', 'aria-haspopup="true" aria-expanded="false" aria-controls="view-options-panel"')}${button('MoreHorizontal', '문서 메뉴', 'phone-document-menu', 'aria-haspopup="dialog" aria-expanded="false" aria-controls="phone-document-panel"')}</div><div class="view-options-panel" id="view-options-panel" hidden><div class="view-panel-heading">페이지 보기</div><button class="view-layout-button" type="button" data-action="two-page" aria-pressed="false">${icon('BookOpen', 19)}<span><strong>두 페이지</strong><small>양쪽 페이지에 바로 필기</small></span><span class="view-layout-check">${icon('Check', 15)}</span></button><div class="view-panel-divider"></div><div class="view-panel-heading">배율</div><div class="view-zoom-controls">${button('Minus', '축소', 'zoom-out')}<button id="zoom-value" data-action="fit">80%</button>${button('Plus', '확대', 'zoom-in')}</div><button class="view-fit-button" data-action="fit">화면에 맞춤</button><div class="view-panel-paper" id="paper-description">A4 · 줄노트</div><button class="view-fit-button" type="button" data-action="paper">속지 설정</button></div></header>
      <div class="ink-toolbar" role="toolbar" aria-label="필기 도구"><div class="toolbar-tools"><div class="tool-group editor-utility">${button('PanelLeft', '페이지 목록', 'sidebar', 'aria-expanded="false" aria-controls="page-sidebar"')}<span class="toolbar-separator"></span>${button('Undo2', '실행 취소 (Ctrl+Z)', 'undo', 'disabled')}${button('Redo2', '다시 실행 (Ctrl+Shift+Z)', 'redo', 'disabled')}</div><div class="tool-group drawing-tools"><button class="tool-button pen-tool active" data-action="pen-menu" aria-label="펜" aria-haspopup="dialog" aria-expanded="false" aria-pressed="true" title="펜">${icon('PenLine', 22)}<span>펜</span></button>${([['highlighter', 'Highlighter', '형광펜'], ['eraser', 'Eraser', '지우개'], ['lasso', 'Lasso', '올가미'], ['shape', 'Shapes', '도형'], ['text', 'Type', '텍스트'], ['image', 'Image', '이미지'], ['hand', 'Hand', '이동']] as const).map(([tool, i, label]) => `<button class="tool-button" data-action="tool" data-id="${tool}" aria-label="${label}" aria-pressed="false" title="${label}">${icon(i, 22)}<span>${label}</span></button>`).join('')}</div></div><div class="ink-style-controls"><div class="color-palette">${this.palette.map((c, n) => `<button class="color-swatch ${c === this.engine?.options.color || !this.engine && n === 0 ? 'active' : ''}" style="--color:${c}" data-action="color" data-id="${c}" title="기본 색상 ${n + 1}" aria-label="기본 색상 ${n + 1}"></button>`).join('')}<button class="palette-edit" type="button" data-action="palette-edit" aria-label="기본 색상 편집" title="기본 색상 편집">${icon('Pencil', 14)}</button><button class="custom-color" type="button" data-action="custom-color" title="색상 선택" aria-label="색상 선택">${icon('Plus', 15)}</button></div><div class="pen-width-control"><label id="width-label" for="ink-width">굵기</label><div class="pencil-mode-picker" hidden><button type="button" id="ink-adjustment" class="pencil-mode-trigger" data-action="pencil-mode-menu" aria-label="연필 조절 항목: 굵기" aria-expanded="false" aria-controls="pencil-mode-menu"><span>굵기</span>${icon('ChevronDown', 13)}</button><div class="pencil-mode-menu" id="pencil-mode-menu" role="group" aria-label="연필 조절 항목" hidden><span class="pencil-mode-heading">연필 조절</span><button type="button" data-action="pencil-mode" data-id="width" aria-pressed="true"><span><strong>굵기</strong><small>선의 두께</small></span>${icon('Check', 15)}</button><button type="button" data-action="pencil-mode" data-id="darkness" aria-pressed="false"><span><strong>진하기</strong><small>흑연의 농도</small></span>${icon('Check', 15)}</button></div></div><span id="width-preview" aria-hidden="true"></span><button type="button" data-action="pen-thinner" aria-label="펜 굵기 줄이기" title="펜 굵기 줄이기">${icon('Minus', 15)}</button><input id="ink-width" type="range" min="0.5" max="20" step="0.5" value="3" aria-label="펜 굵기" /><button type="button" data-action="pen-thicker" aria-label="펜 굵기 늘리기" title="펜 굵기 늘리기">${icon('Plus', 15)}</button><output id="width-value" for="ink-width">3.0</output></div></div><div class="editor-options">${button('Settings2', '필기 옵션', 'writing-options', 'aria-haspopup="dialog" aria-expanded="false" aria-controls="writing-options-panel"')}</div></div>
      <div class="editor-body"><aside class="page-sidebar" id="page-sidebar" hidden><div class="page-sidebar-heading"><strong>페이지</strong><span>${this.note.pageIds.length}</span>${button('Plus', '페이지 추가', 'add-page')}</div><div id="page-thumbnails"></div><button class="add-page-button" data-action="add-page">${icon('Plus', 17)} 페이지 추가</button></aside>
        <main class="paper-viewport" aria-label="필기 작업 공간"><div class="paper-stage"><div class="paper-sizing"><div class="paper-surface"><canvas id="paper-background" aria-hidden="true"></canvas><canvas id="paper-ink" aria-hidden="true"></canvas><canvas id="paper-live" aria-label="필기 캔버스"></canvas></div><span class="spread-page-number" hidden></span></div><div class="spread-companion" role="group" aria-label="인접 페이지" hidden><canvas class="spread-background" aria-hidden="true"></canvas><canvas class="spread-ink" aria-hidden="true"></canvas><canvas class="spread-live" aria-label="인접 페이지 필기 캔버스"></canvas><span class="spread-page-number"></span></div><button class="spread-empty" type="button" data-action="add-page" hidden>${icon('Plus', 22)}<span>페이지 추가</span></button></div><div class="page-loading" hidden>페이지를 불러오는 중…</div></main>
      </div>
      <div class="phone-document-panel" id="phone-document-panel" role="dialog" aria-label="문서 메뉴" popover="auto"><div class="phone-document-heading">문서 메뉴</div><div class="phone-document-primary"></div><div class="phone-document-secondary"></div></div>
      <div class="selection-toolbar" hidden><span id="selection-count"></span>${button('CopyPlus', '선택 복제', 'selection-duplicate')}${button('Plus', '선택 확대', 'selection-grow')}${button('Minus', '선택 축소', 'selection-shrink')}${button('Trash2', '선택 삭제', 'selection-delete')}${button('X', '선택 해제', 'deselect')}</div>
    </div>`;
    if (isNativeApp) {
      this.root.querySelector('[data-action=search]')!.insertAdjacentHTML('beforebegin',
        button('Globe2', '인터넷 패널', 'study-browser', 'aria-expanded="false"')
        + `<button class="icon-button study-ai-button" type="button" data-action="study-ai" aria-label="AI · ${studyAILabel(this.aiProvider)} 열기" title="AI · ${studyAILabel(this.aiProvider)} 열기" aria-expanded="false">AI</button>`);
      this.studyBrowserObserver = new MutationObserver(() => this.syncStudyPanelOverlay());
      this.studyBrowserObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    }
    if (this.note.temporary) {
      const save = document.createElement('button');
      save.type = 'button'; save.className = 'external-pdf-save'; save.dataset.action = 'save-to-library';
      save.textContent = '서재에 저장';
      this.root.querySelector('.editor-header-actions')!.prepend(save);
      const notice = document.createElement('div');
      notice.className = 'external-pdf-notice';
      notice.textContent = '외부 PDF · 서재에 저장하지 않고 닫으면 이 문서의 필기가 삭제돼요.';
      notice.setAttribute('role', 'status');
      this.root.querySelector('.editor-body')!.append(notice);
      this.temporaryNoticeTimer = setTimeout(() => {
        notice.classList.add('is-leaving');
        setTimeout(() => notice.remove(), 250);
      }, 4000);
    }
    this.studyTimer = new StudyTimer(this.root, this.note.id);
    await this.studyTimer.start();
    bindPhoneEditor(this.root, this.abort.signal);
    window.addEventListener('notelin-study-browser-closed', () => this.setStudyPanel(null), { signal: this.abort.signal });
    window.addEventListener('notelin-study-browser-resized', event => {
      const detail = (event as CustomEvent<{ ratio: number; side?: string }>).detail;
      const ratio = detail?.ratio;
      if (detail?.side === 'left' || detail?.side === 'right') document.documentElement.dataset.studyPanelSide = detail.side;
      if (Number.isFinite(ratio) && ratio >= .1 && ratio <= 1) {
        this.root.querySelector<HTMLElement>('.editor-shell')?.style.setProperty('--study-browser-width', `${ratio * 100}vw`);
      }
    }, { signal: this.abort.signal });
    window.addEventListener('notelin-native-back', event => {
      if (this.studyPanel && !this.studyPanelOccluded) { event.preventDefault(); run(() => this.closeStudyPanel()); }
    }, { signal: this.abort.signal });
    if (isNativeApp) window.addEventListener('notelin-native-stylus-button', () => {
      if (!document.querySelector('dialog[open]')) this.togglePenEraser();
    }, { signal: this.abort.signal });
    this.viewport = this.root.querySelector('.paper-viewport')!;
    this.engine = new InkEngine(this.root.querySelector('#paper-ink')!, this.root.querySelector('#paper-live')!, () => this.changed(), count => this.showSelection(count, this.engine),
      (p, tool) => this.insert(p, tool), () => toast('직선으로 정리했어요. 펜을 댄 채 끝점을 움직일 수 있어요.'), () => this.togglePenEraser());
    this.companionEngine = new InkEngine(this.root.querySelector('.spread-ink')!, this.root.querySelector('.spread-live')!,
      () => this.changed(this.companionEngine.page), count => this.showSelection(count, this.companionEngine),
      (p, tool) => run(async () => { const index = this.companionIndex(); await this.showPage(index); if (this.index === index) this.insert(p, tool); }),
      () => toast('직선으로 정리했어요. 펜을 댄 채 끝점을 움직일 수 있어요.'), () => this.togglePenEraser());
    this.detail = new DetailRenderer(this.root.querySelector('.paper-surface')!, this.root.querySelector('#paper-live')!,
      this.viewport, this.root.querySelector('#paper-background')!, this.root.querySelector('#paper-ink')!, report);
    this.companionDetail = new DetailRenderer(this.root.querySelector('.spread-companion')!, this.root.querySelector('.spread-live')!,
      this.viewport, this.root.querySelector('.spread-background')!, this.root.querySelector('.spread-ink')!, report);
    this.engine.setSharpPreview((item, recompute) => this.detail.preview(item, recompute));
    this.companionEngine.setSharpPreview((item, recompute) => this.companionDetail.preview(item, recompute));
    this.engine.setPalmGuard(this.palmGuard); this.companionEngine.setPalmGuard(this.palmGuard);
    this.engine.setInkRendered((page, region) => this.detail.refreshInk(page, region));
    this.companionEngine.setInkRendered((page, region) => this.companionDetail.refreshInk(page, region));
    this.companionEngine.options = this.engine.options;
    this.editingEngine = this.engine;
    this.root.querySelector('.paper-sizing')!.addEventListener('pointerdown', () => this.focusEngine(this.engine), { capture: true, signal: this.abort.signal });
    this.root.querySelector('.spread-companion')!.addEventListener('pointerdown', () => this.focusEngine(this.companionEngine), { capture: true, signal: this.abort.signal });
    this.engine.options.samsungButtonToggle = typeof penButtonSetting?.value === 'boolean'
      ? penButtonSetting.value : /SamsungBrowser\//.test(navigator.userAgent);
    if (shapeChoices.some(choice => choice.id === shapeSetting?.value)) this.engine.options.shape = shapeSetting!.value as Shape;
    this.textEditor = new InlineTextEditor(this.root.querySelector('.paper-surface')!, this.root.querySelector('.editor-shell')!, this.engine,
      (head, tail) => this.continueTyping(head, tail), () => { this.syncInkControl(); this.syncColor(); });
    if (typeof textColorSetting?.value === 'string' && /^#[0-9a-f]{6}$/i.test(textColorSetting.value)) this.textEditor.setColor(textColorSetting.value);
    if (typeof lineSetting?.value === 'boolean') this.engine.options.holdToLine = lineSetting.value;
    const eraser = eraserSetting?.value as { partial?: boolean; size?: number } | undefined;
    if (typeof eraser?.partial === 'boolean') this.engine.options.partialEraser = eraser.partial;
    if (typeof eraser?.size === 'number' && eraser.size >= 8 && eraser.size <= 100) this.engine.options.eraserSize = eraser.size;
    const eraserButton = this.root.querySelector('[data-action=tool][data-id=eraser]')!;
    eraserButton.setAttribute('aria-haspopup', 'dialog'); eraserButton.setAttribute('aria-expanded', 'false'); eraserButton.setAttribute('aria-controls', 'eraser-picker');
    const shapeButton = this.root.querySelector('[data-action=tool][data-id=shape]')!;
    shapeButton.setAttribute('aria-haspopup', 'dialog'); shapeButton.setAttribute('aria-expanded', 'false'); shapeButton.setAttribute('aria-controls', 'shape-picker');
    const imageButton = this.root.querySelector('[data-action=tool][data-id=image]')!;
    imageButton.setAttribute('aria-haspopup', 'dialog'); imageButton.setAttribute('aria-expanded', 'false'); imageButton.setAttribute('aria-controls', 'image-picker');
    this.syncShapeButton();
    this.previews = new PagePreviews(this.root.querySelector('#page-thumbnails')!, this.root.querySelector('.page-sidebar')!,
      () => this.engine.activePointer !== null || this.companionEngine.activePointer !== null || this.viewport.classList.contains('zoom-preview'),
      (id, preview, revision) => { if (this.page?.id === id && this.page.revision === revision) this.page.thumbnail = preview; });
    this.selectTool(this.selectedPen().tool);
    const widthSlider = this.root.querySelector<HTMLInputElement>('#ink-width')!;
    const widthFromPointer = (e: PointerEvent) => {
      const rect = widthSlider.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left - 10) / Math.max(1, rect.width - 20)));
      this.setInkValue(Number(widthSlider.min) + fraction * (Number(widthSlider.max) - Number(widthSlider.min)));
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
      if (this.adjustingDarkness) this.persistPencilDarkness();
      if (this.engine.options.tool === 'text') this.textEditor.focus();
      if (widthSlider.hasPointerCapture(e.pointerId)) widthSlider.releasePointerCapture(e.pointerId);
    }, { signal: this.abort.signal });
    widthSlider.addEventListener('pointercancel', () => this.widthPointer = null, { signal: this.abort.signal });
    widthSlider.addEventListener('lostpointercapture', () => this.widthPointer = null, { signal: this.abort.signal });
    this.root.addEventListener('click', e => this.click(e), { signal: this.abort.signal });
    document.addEventListener('pointerdown', event => {
      const panel = this.root.querySelector<HTMLElement>('#view-options-panel')!;
      if (!panel.hidden && !panel.contains(event.target as Node) && !this.root.querySelector('[data-action=view-options]')!.contains(event.target as Node)) this.closeViewOptions();
    }, { capture: true, signal: this.abort.signal });
    this.root.addEventListener('input', e => this.input(e), { signal: this.abort.signal });
    this.root.addEventListener('change', e => {
      const id = (e.target as HTMLElement).id;
      if (id === 'ink-width') this.input(e);
      if (id === 'ink-width' && this.adjustingDarkness) this.persistPencilDarkness();
    }, { signal: this.abort.signal });
    document.addEventListener('pointerdown', e => {
      if (!this.root.querySelector('.pencil-mode-picker')?.contains(e.target as Node)) this.closePencilMode();
    }, { signal: this.abort.signal });
    document.addEventListener('keydown', e => this.keyboard(e), { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) run(() => this.flush()); }, { signal: this.abort.signal });
    window.addEventListener('beforeunload', e => { if (!isAppReloadApproved()) { e.preventDefault(); e.returnValue = ''; } }, { signal: this.abort.signal });
    this.setupGestures();
    const rememberedPage = this.note.pageIds.indexOf(this.note.lastPageId ?? '');
    await this.showPage(rememberedPage < 0 ? 0 : rememberedPage);
    this.resizeObserver = new ResizeObserver(() => { if (this.fit && this.page) { this.setScale(this.fitScale(), true); void this.renderBackground(); void this.renderSpread(); } });
    this.resizeObserver.observe(this.viewport);
  }
  private companionIndex(index = this.index) { return index % 2 ? index - 1 : index + 1; }
  private spreadStart() { return Math.floor(this.index / 2) * 2; }
  private fitScale() {
    const stage = this.root.querySelector<HTMLElement>('.paper-stage')!, style = getComputedStyle(stage);
    const gutter = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const gap = this.twoPage ? parseFloat(style.columnGap) || 18 : 0;
    const width = this.page.width + (this.twoPage ? this.spreadPage?.width || this.page.width : 0);
    return Math.min(1.35, Math.max(this.twoPage ? .16 : .2, (this.viewport.clientWidth - gutter - gap) / width));
  }
  async showPage(index: number) {
    if (index < 0 || index >= this.note.pageIds.length || this.switching) return;
    this.switching = true;
    this.spreadGeneration++;
    this.cancelViewportUpdate();
    const loading = this.root.querySelector<HTMLElement>('.page-loading')!; loading.hidden = false;
    let failed = false;
    loading.classList.remove('page-load-error'); loading.textContent = '페이지를 불러오는 중…';
    try {
      if (this.page) { this.engine.cancel(); this.companionEngine.cancel(); await this.flush(); }
      const companionId = this.twoPage ? this.note.pageIds[this.companionIndex(index)] : undefined;
      const [page, companion] = await Promise.all([db.pages.get(this.note.pageIds[index]), companionId ? db.pages.get(companionId) : undefined]);
      if (!page) throw new Error('페이지를 찾을 수 없어요.');
      this.spreadPage = companion;
      await loadImages(page); this.displayPage(page, index);
      await this.renderBackground(); void this.renderSpread(); await this.renderThumbnails(); this.updateHistory();
    } catch (error) {
      failed = true;
      loading.classList.add('page-load-error');
      loading.innerHTML = `<div><h2>페이지를 표시하지 못했어요</h2><p>${escape(error instanceof Error ? error.message : '페이지를 다시 열어 주세요.')}</p><div><button class="button secondary" data-action="retry-page">다시 시도</button><button class="button primary" data-action="home">서재로 돌아가기</button></div></div>`;
      console.warn('Page rendering failed; notebook data is preserved.', error);
    } finally { this.switching = false; loading.hidden = !failed; }
    if (!failed && this.engine.options.tool === 'text' && this.textEditor.mode === 'document') this.textEditor.open();
  }
  private displayPage(page: Page, index: number) {
    this.index = index; this.page = page; this.engine.load(page);
    if (this.note.lastPageId !== page.id) {
      this.note.lastPageId = page.id;
      const write = this.pageSelectionWrites.catch(() => {}).then(() => db.notes.update(this.note.id, { lastPageId: page.id }));
      this.pageSelectionWrites = write.then(() => {});
      void write.catch(report);
    }
    this.syncSpreadLayout();
    this.focusEngine(this.engine);
    this.setScale(this.fit ? this.fitScale() : this.scale, this.fit); this.viewport.scrollTo({ left: 0, top: 0 });
    this.updatePageNavigation();
    this.root.querySelector('#paper-description')!.textContent = page.pdfAssetId ? 'PDF · 원본 위에 필기' : `${Math.round(page.width)} × ${Math.round(page.height)} · ${paperNames[page.paper]}`;
    this.updateHistory();
  }
  private updatePageNavigation() {
    const first = this.twoPage ? this.spreadStart() : this.index;
    const last = this.twoPage ? Math.min(first + 1, this.note.pageIds.length - 1) : first;
    this.root.querySelector('.page-position')!.textContent = first === last ? `${first + 1} / ${this.note.pageIds.length}` : `${first + 1}–${last + 1} / ${this.note.pageIds.length}`;
    this.root.querySelector<HTMLButtonElement>('[data-action=prev-page]')!.disabled = first === 0;
    this.root.querySelector<HTMLButtonElement>('[data-action=next-page]')!.disabled = last === this.note.pageIds.length - 1;
  }
  private syncSpreadLayout() {
    const stage = this.root.querySelector<HTMLElement>('.paper-stage')!;
    const companion = this.root.querySelector<HTMLElement>('.spread-companion')!;
    const empty = this.root.querySelector<HTMLButtonElement>('.spread-empty')!;
    const active = this.root.querySelector<HTMLElement>('.paper-sizing')!;
    const otherIndex = this.companionIndex();
    stage.classList.toggle('two-page', this.twoPage);
    companion.hidden = !this.twoPage || !this.spreadPage;
    empty.hidden = !this.twoPage || !!this.spreadPage;
    if (this.twoPage && this.spreadPage && this.companionEngine.page !== this.spreadPage) this.companionEngine.load(this.spreadPage);
    active.style.order = this.twoPage && this.index % 2 ? '2' : '0';
    companion.style.order = this.twoPage && this.index % 2 ? '0' : '2';
    empty.style.order = '2';
    companion.setAttribute('aria-label', `${otherIndex + 1}페이지`);
    companion.querySelector('.spread-live')!.setAttribute('aria-label', `${otherIndex + 1}페이지 필기 캔버스`);
    companion.querySelector('.spread-page-number')!.textContent = String(otherIndex + 1);
    const badge = active.querySelector<HTMLElement>('.spread-page-number')!;
    badge.hidden = !this.twoPage; badge.textContent = String(this.index + 1);
    const toggle = this.root.querySelector<HTMLButtonElement>('[data-action=two-page]')!;
    toggle.setAttribute('aria-pressed', String(this.twoPage));
    toggle.setAttribute('aria-label', this.twoPage ? '한 페이지 보기' : '두 페이지 보기');
    toggle.title = this.twoPage ? '한 페이지 보기' : '두 페이지 보기';
  }
  private async toggleTwoPage() {
    this.engine.cancel(); this.companionEngine.cancel(); this.twoPage = !this.twoPage;
    const activeId = this.page.id;
    const enabled = this.twoPage, companionId = enabled ? this.note.pageIds[this.companionIndex()] : undefined;
    this.spreadGeneration++;
    const companion = companionId ? await db.pages.get(companionId) : undefined;
    if (this.twoPage !== enabled || this.page.id !== activeId) return;
    this.spreadPage = companion;
    if (!this.twoPage) this.focusEngine(this.engine);
    this.syncSpreadLayout(); this.updatePageNavigation();
    this.setScale(this.fit ? this.fitScale() : this.scale, this.fit);
    void db.settings.put({ key: 'two-page-view', value: this.twoPage }).catch(report);
    void this.renderBackground(); void this.renderSpread(); void this.renderThumbnails();
  }
  private async renderSpread() {
    const generation = ++this.spreadGeneration, page = this.spreadPage;
    if (!this.twoPage || !page) return;
    const companion = this.root.querySelector<HTMLElement>('.spread-companion')!;
    try {
      await loadImages(page);
      const ratio = Math.min(Math.max(1, this.scale * devicePixelRatio), Math.sqrt(8000000 / (page.width * page.height)));
      const backgroundCanvas = document.createElement('canvas'); await background(backgroundCanvas, page, ratio);
      if (generation !== this.spreadGeneration || this.abort.signal.aborted) return;
      const canvas = companion.querySelector<HTMLCanvasElement>('.spread-background')!;
      canvas.width = backgroundCanvas.width; canvas.height = backgroundCanvas.height;
      canvas.getContext('2d')!.drawImage(backgroundCanvas, 0, 0);
      this.companionEngine.resize();
      this.companionDetail.schedule(0);
      companion.classList.remove('spread-error');
    } catch (error) {
      if (generation === this.spreadGeneration) companion.classList.add('spread-error');
      console.warn('Adjacent page preview unavailable.', error);
    }
  }
  private continueTyping(head: TextItem, remaining: string) {
    const source = this.page, pages: Page[] = [], ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = textFont(head);
    while (remaining) {
      const page = newPage(this.note.id, { width: source.width, height: source.height, paper: source.paper, paperColor: source.paperColor, spacing: source.spacing });
      const item: TextItem = { ...head, ...documentFrame(page), id: uid(), text: remaining };
      const [text, tail] = splitDocument(item, page, text => ctx.measureText(text).width);
      item.text = text; page.items = [item]; pages.push(page); remaining = tail;
    }
    const ids = this.note.pageIds.slice(); ids.splice(this.index + 1, 0, ...pages.map(page => page.id)); this.note.pageIds = ids;
    // This is queued before any typing on the next page. Save the current head,
    // continuation pages and their note order in one transaction.
    const saved = this.queue.savePages(this.note, [source, ...pages]);
    const companionId = this.note.pageIds[this.companionIndex(this.index + pages.length)];
    this.spreadPage = this.twoPage ? [source, ...pages].find(page => page.id === companionId) : undefined;
    this.displayPage(pages[pages.length - 1], this.index + pages.length);
    this.textEditor.open(undefined, true); run(() => this.renderBackground()); void this.renderSpread();
    run(async () => {
      await saved;
      if (this.twoPage && !this.spreadPage && companionId) {
        this.spreadPage = await db.pages.get(companionId); this.syncSpreadLayout();
        if (this.fit) this.setScale(this.fitScale(), true);
        void this.renderSpread();
      }
      await this.renderThumbnails();
    });
  }
  private async renderBackground() {
    const generation = ++this.generation, p = this.page, temp = document.createElement('canvas');
    const ratio = Math.min(Math.max(1, this.scale * devicePixelRatio), Math.sqrt(10000000 / (p.width * p.height)));
    await background(temp, p, ratio);
    if (generation !== this.generation || this.abort.signal.aborted) return;
    const canvas = this.root.querySelector<HTMLCanvasElement>('#paper-background')!;
    canvas.width = temp.width; canvas.height = temp.height; canvas.getContext('2d')!.drawImage(temp, 0, 0);
    this.detail.schedule(0);
  }
  private async renderThumbnails() {
    const rows = await db.pages.bulkGet(this.note.pageIds);
    if (this.abort.signal.aborted) return;
    this.root.querySelector('#page-thumbnails')!.innerHTML = rows.map((p, i) => p ? `<div class="page-thumb-row ${i === this.index ? 'active' : this.twoPage && i === this.companionIndex() ? 'spread-visible' : ''}"><button class="page-thumb" data-action="page" data-id="${i}" data-page-id="${p.id}" aria-label="${i + 1}페이지"><div class="page-thumb-paper ${p.paper}" style="aspect-ratio:${p.width}/${p.height}">${p.thumbnail ? `<img src="${p.thumbnail}" alt="${i + 1}페이지 미리보기"/>` : `<span>${p.pdfAssetId ? 'PDF' : paperNames[p.paper]}</span>`}</div><span>${i + 1}</span></button>${button('MoreHorizontal', `${i + 1}페이지 메뉴`, 'page-menu', `data-id="${i}"`)}</div>` : '').join('');
    this.root.querySelector('.page-sidebar-heading > span')!.textContent = String(this.note.pageIds.length);
    this.previews.observe(rows);
  }
  private showSelection(count: number, engine: InkEngine) {
    if (this.editingEngine !== engine) return;
    this.root.querySelector<HTMLElement>('.selection-toolbar')!.hidden = !count;
    this.root.querySelector('#selection-count')!.textContent = `${count}개 선택 · 드래그로 이동`;
  }
  private focusEngine(engine: InkEngine) {
    if (this.editingEngine !== engine) {
      this.editingEngine?.clearSelection();
      this.editingEngine = engine;
      this.showSelection(engine.selected.size, engine);
    }
    this.updateHistory();
  }
  private changed(page = this.page) {
    this.updateHistory();
    if (page.id === this.page.id) this.detail.refreshInk(page);
    else this.companionDetail.refreshInk(page);
    page.thumbnail = undefined;
    void this.queue.saveImmutable(page).catch(report);
    if (page.id === this.page.id) {
      clearTimeout(this.thumbTimer);
      this.thumbTimer = setTimeout(() => run(() => this.saveThumbnail(page)), 1400);
    } else {
      clearTimeout(this.companionThumbTimer);
      this.companionThumbTimer = setTimeout(() => run(() => this.saveThumbnail(page)), 1400);
    }
  }
  private async saveThumbnail(page: Page) {
    if (this.engine.activePointer !== null || this.companionEngine.activePointer !== null || this.viewport.classList.contains('zoom-preview')) {
      const timer = setTimeout(() => run(() => this.saveThumbnail(page)), 500);
      if (page.id === this.page.id) this.thumbTimer = timer; else this.companionThumbTimer = timer;
      return;
    }
    const revision = page.revision, snapshot = { ...page, items: page.items.slice() }, thumb = await thumbnail(snapshot);
    if (page.revision !== revision) return;
    page.thumbnail = thumb; await this.queue.saveImmutable(page, thumb);
    if (this.note.pageIds.includes(page.id) && !this.abort.signal.aborted) await this.renderThumbnails();
  }
  async flush() {
    this.textEditor?.finish();
    clearTimeout(this.thumbTimer);
    clearTimeout(this.companionThumbTimer);
    // Navigation and PWA updates depend only on durable data. PDF rendering is
    // optional presentation work and must never prevent leaving the editor.
    if (this.page) await this.queue.saveImmutable(this.page);
    if (this.twoPage && this.spreadPage) await this.queue.saveImmutable(this.spreadPage);
    await this.queue.flush();
    await this.brushWrites; await this.persistBrushes();
    await this.penWrites; await this.persistPens();
    await this.pageSelectionWrites;
  }
  private updateHistory() {
    this.root.querySelector<HTMLButtonElement>('[data-action=undo]')!.disabled = !this.editingEngine.canUndo;
    this.root.querySelector<HTMLButtonElement>('[data-action=redo]')!.disabled = !this.editingEngine.canRedo;
  }
  private setScale(scale: number, fit = false, rasterize = true) {
    this.scale = Math.max(this.twoPage ? .16 : .2, Math.min(4, scale)); this.fit = fit;
    const size = this.root.querySelector<HTMLElement>('.paper-sizing')!;
    size.style.width = `${this.page.width * this.scale}px`; size.style.height = `${this.page.height * this.scale}px`;
    const companion = this.root.querySelector<HTMLElement>('.spread-companion')!;
    companion.style.width = `${(this.spreadPage?.width || this.page.width) * this.scale}px`;
    companion.style.height = `${(this.spreadPage?.height || this.page.height) * this.scale}px`;
    const empty = this.root.querySelector<HTMLElement>('.spread-empty')!;
    empty.style.width = `${this.page.width * this.scale}px`; empty.style.height = `${this.page.height * this.scale}px`;
    this.textEditor.setScale(this.scale);
    this.root.querySelector('#zoom-value')!.textContent = `${Math.round(this.scale * 100)}%`;
    if (rasterize) {
      this.engine.resize(); if (this.twoPage && this.spreadPage) this.companionEngine.resize();
      this.detail.set(this.page, this.scale);
      this.companionDetail.set(this.twoPage ? this.spreadPage : undefined, this.scale);
    }
  }
  private zoom(scale: number) {
    this.cancelViewportUpdate();
    this.engine.cancel(); this.companionEngine.cancel(); this.setScale(scale); run(() => this.renderBackground()); void this.renderSpread();
  }
  private closeViewOptions() {
    this.root.querySelector<HTMLElement>('#view-options-panel')!.hidden = true;
    this.root.querySelector('[data-action=view-options]')!.setAttribute('aria-expanded', 'false');
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
    this.engine.resize(); if (this.twoPage && this.spreadPage) this.companionEngine.resize(); this.viewport.classList.remove('zoom-preview');
    this.detail.set(this.page, this.scale);
    this.companionDetail.set(this.twoPage ? this.spreadPage : undefined, this.scale);
    run(() => this.renderBackground()); void this.renderSpread();
  }
  private click(e: Event) {
    const target = (e.target as Element).closest<HTMLElement>('[data-action]'); if (!target) return;
    const { action, id } = target.dataset;
    if (action && !['color', 'custom-color', 'palette-edit', 'pen-thinner', 'pen-thicker', 'pencil-mode-menu', 'pencil-mode'].includes(action)) this.textEditor.finish();
    if (action === 'home') run(this.home);
    if (action === 'retry-page') run(() => this.showPage(this.index));
    if (action === 'tab' && id !== this.note.id) run(() => this.open(id!));
    if (action === 'close-tab') run(() => this.closeTab(id!));
    if (action === 'tool') {
      if (id === 'shape' && this.root.querySelector('.shape-picker:popover-open')) this.root.querySelector<HTMLElement>('.shape-picker:popover-open')!.hidePopover();
      else if (id === 'image' && this.root.querySelector('.image-picker:popover-open')) this.root.querySelector<HTMLElement>('.image-picker:popover-open')!.hidePopover();
      else {
        this.selectTool(id as Tool);
        if (id === 'eraser') this.showEraserPicker(target);
        if (id === 'shape') this.showShapePicker(target);
        if (id === 'image') this.showImagePicker(target);
      }
    }
    if (action === 'shape-select') {
      const selected = shapeChoices.find(choice => choice.id === id);
      if (selected) {
        this.engine.options.shape = selected.id;
        this.syncShapeButton();
        this.root.querySelector<HTMLElement>('.shape-picker:popover-open')?.hidePopover();
        void db.settings.put({ key: `note-shape:${this.note.id}`, value: selected.id }).catch(report);
      }
    }
    if (action === 'image-upload') {
      this.root.querySelector<HTMLElement>('.image-picker:popover-open')?.hidePopover();
      const page = this.page;
      run(async () => {
        const file = await pickFile('image/png,image/jpeg,image/webp');
        if (file) await this.addImage(file, page);
      });
    }
    if (action === 'close-image') this.root.querySelector<HTMLElement>('.image-picker:popover-open')?.hidePopover();
    if (action === 'pen-menu') {
      const open = this.root.querySelector<HTMLElement>('.pen-picker:popover-open');
      if (open) open.hidePopover();
      else { if (!isPenKind(this.engine.options.tool)) this.selectTool(this.selectedPen().tool); this.showPenPicker(target); }
    }
    if (action === 'pen-select') {
      const preset = this.pens.presets.find(pen => pen.id === id);
      if (preset) { this.pens.selectedId = preset.id; this.selectTool(preset.tool); this.rememberPens(); this.root.querySelector<HTMLElement>('.pen-picker:popover-open')?.hidePopover(); }
    }
    if (action === 'pen-arrange') this.renderPenPicker(this.root.querySelector<HTMLElement>('.pen-picker')!, 'arrange');
    if (action === 'pen-list') this.renderPenPicker(this.root.querySelector<HTMLElement>('.pen-picker')!, 'list');
    if (action === 'pen-add') {
      if (this.pens.presets.length >= 48) return toast('펜은 최대 48개까지 저장할 수 있어요.');
      this.penDraft = duplicatePen(this.selectedPen(), this.pens.presets.length + 1);
      this.renderPenPicker(this.root.querySelector<HTMLElement>('.pen-picker')!, 'edit');
    }
    if (action === 'pen-edit') {
      const preset = this.pens.presets.find(pen => pen.id === id);
      if (preset) { this.penDraft = { ...preset }; this.renderPenPicker(this.root.querySelector<HTMLElement>('.pen-picker')!, 'edit'); }
    }
    if (action === 'pen-kind' && isPenKind(id) && this.penDraft) {
      this.penDraft.tool = id; this.root.querySelectorAll<HTMLElement>('.pen-edit-kind').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === id)));
      this.root.querySelector<HTMLElement>('.pen-edit-darkness')!.hidden = id !== 'pencil';
    }
    if (action === 'pen-color' && this.penDraft) {
      const draft = this.penDraft;
      openColorPicker(draft.color, undefined, color => {
        if (this.penDraft !== draft) return;
        draft.color = color;
        this.root.querySelector<HTMLElement>('.pen-edit-color-swatch')?.style.setProperty('background-color', color);
        const label = this.root.querySelector<HTMLElement>('.pen-edit-color-value'); if (label) label.textContent = color.toUpperCase();
      }, target);
    }
    if (action === 'pen-save') this.savePenDraft();
    if (action === 'pen-move' && id) this.movePen(id, Number(target.dataset.step));
    if (action === 'pen-delete' && id) this.deletePen(id);
    if (action === 'close-pen') this.root.querySelector<HTMLElement>('.pen-picker:popover-open')?.hidePopover();
    if (action === 'eraser-mode') {
      this.setEraserMode(id === 'partial');
      this.root.querySelector<HTMLElement>('#eraser-picker')?.hidePopover();
    }
    if (action === 'close-eraser') this.root.querySelector<HTMLElement>('#eraser-picker')?.hidePopover();
    if (action === 'pen-button-help') {
      const guide = this.root.querySelector<HTMLElement>('#pen-button-guide')!;
      guide.hidden = !guide.hidden; target.setAttribute('aria-expanded', String(!guide.hidden));
    }
    if (action === 'pen-button-check') {
      this.root.querySelector<HTMLElement>('#eraser-picker')?.hidePopover(); this.engine.cancel(); showPenCheck();
    }
    if (action === 'color') this.setColor(id!);
    if (action === 'palette-edit') openColorPicker(this.activeColor(), this.palette, async (color, palette) => {
      this.palette = palette!; this.renderPalette(); this.setColor(color);
      await db.settings.put({ key: `note-palette:${this.note.id}`, value: this.palette });
    }, target);
    if (action === 'custom-color') openColorPicker(this.activeColor(), undefined, color => this.setColor(color), target);
    if (action === 'pencil-mode-menu') {
      const menu = this.root.querySelector<HTMLElement>('#pencil-mode-menu')!;
      menu.hidden = !menu.hidden; target.setAttribute('aria-expanded', String(!menu.hidden));
    }
    if (action === 'pencil-mode' && (id === 'width' || id === 'darkness')) {
      this.inkAdjustment = id; this.syncInkControl(); this.rememberBrush();
      this.closePencilMode(); this.root.querySelector<HTMLButtonElement>('#ink-adjustment')!.focus({ preventScroll: true });
    }
    if (action === 'pen-thinner' || action === 'pen-thicker') {
      const slider = this.root.querySelector<HTMLInputElement>('#ink-width')!;
      this.setInkValue(Number(slider.value) + Number(slider.step) * (action === 'pen-thinner' ? -1 : 1));
      if (this.adjustingDarkness) this.persistPencilDarkness();
      if (this.engine.options.tool === 'text') this.textEditor.focus();
    }
    if (action === 'undo') this.editingEngine.undo();
    if (action === 'redo') this.editingEngine.redo();
    if (action === 'sidebar') { const sidebar = this.root.querySelector<HTMLElement>('.page-sidebar')!; sidebar.hidden = !sidebar.hidden; target.setAttribute('aria-expanded', String(!sidebar.hidden)); target.classList.toggle('active', !sidebar.hidden); if (this.fit) this.setScale(this.fitScale(), true); }
    if (action === 'zoom-in') this.zoom(this.scale * 1.2);
    if (action === 'zoom-out') this.zoom(this.scale / 1.2);
    if (action === 'fit') { this.setScale(this.fitScale(), true); run(() => this.renderBackground()); void this.renderSpread(); }
    if (action === 'view-options') {
      const panel = this.root.querySelector<HTMLElement>('#view-options-panel')!;
      panel.hidden = !panel.hidden;
      target.setAttribute('aria-expanded', String(!panel.hidden));
    }
    if (action === 'two-page') run(() => this.toggleTwoPage());
    if (action === 'page') run(() => this.showPage(Number(id)));
    if (action === 'prev-page') run(() => this.showPage(this.twoPage ? this.spreadStart() - 2 : this.index - 1));
    if (action === 'next-page') run(() => this.showPage(this.twoPage ? this.spreadStart() + 2 : this.index + 1));
    if (action === 'add-page') run(() => this.addPage());
    if (action === 'page-menu') this.pageMenu(target, Number(id));
    if (action === 'writing-options') {
      const panel = document.createElement('dialog'); panel.className = 'writing-options-panel'; panel.id = 'writing-options-panel'; panel.setAttribute('aria-label', '필기 옵션');
      panel.innerHTML = `<div class="writing-options-heading"><strong>필기 옵션</strong>${button('X', '필기 옵션 닫기', 'close-writing-options')}</div><p id="tool-hint">${escape(this.toolHint)}</p><div id="context-options">${this.contextOptions()}</div><label class="finger-switch"><input id="hold-to-line" type="checkbox" ${this.engine.options.holdToLine ? 'checked' : ''}/><span></span>길게 멈추면 직선으로</label><label class="finger-switch"><input id="finger-drawing" type="checkbox" ${this.engine.options.fingerDrawing ? 'checked' : ''}/><span></span>손가락 필기</label>`;
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
      this.closeViewOptions();
      this.paperSettings();
    }
    if (action === 'search') this.search();
    if (action === 'study-browser') run(() => this.toggleStudyPanel('browser'));
    if (action === 'study-ai') run(() => this.toggleStudyPanel('ai'));
    if (action === 'save') run(async () => { await this.flush(); await this.saveThumbnail(this.page); toast('저장했어요.'); });
    if (action === 'save-to-library') run(async () => {
      target.setAttribute('disabled', '');
      try {
        await this.flush();
        await db.notes.update(this.note.id, { temporary: false, updated: Date.now() });
        this.note.temporary = false;
        target.remove(); this.root.querySelector('.external-pdf-notice')?.remove();
        toast('서재에 저장했어요.');
      } finally { target.removeAttribute('disabled'); }
    });
    if (action === 'goto-page') modal('페이지 이동', `<label class="form-label">페이지 번호<input type="number" name="page" min="1" max="${this.note.pageIds.length}" value="${this.index + 1}" required /></label>`, '이동', async data => { await this.showPage(Number(data.get('page')) - 1); });
    if (action === 'export') run(async () => {
      await this.flush(); target.setAttribute('disabled', '');
      try { toast('PDF 내보내기를 준비하고 있어요…'); const saved = await exportPDF(this.note, (n, total) => toast(`PDF 생성 중 ${n} / ${total}`)); toast(saved === false ? '저장을 취소했어요.' : 'PDF를 내보냈어요.'); }
      finally { target.removeAttribute('disabled'); }
    });
    if (action?.startsWith('selection-')) { this.editingEngine.selectionAction(action.slice(10)); if (action === 'selection-duplicate') toast('선택한 내용을 복제했어요.'); }
    if (action === 'deselect') this.editingEngine.clearSelection();
  }
  private input(e: Event) {
    const el = e.target as HTMLInputElement;
    if (el.id === 'pen-edit-width') {
      this.root.querySelector<HTMLElement>('.pen-edit-width-value')!.textContent = Number(el.value).toFixed(1);
    }
    if (el.id === 'pen-edit-darkness') {
      this.root.querySelector<HTMLElement>('.pen-edit-darkness-value')!.textContent = `${el.value}%`;
    }
    if (el.id === 'ink-width') this.setInkValue(Number(el.value));
    if (el.id === 'finger-drawing') { this.engine.options.fingerDrawing = el.checked; toast(el.checked ? '손가락으로도 필기할 수 있어요.' : '손가락은 이동, S펜은 필기에 사용해요.'); }
    if (el.id === 'samsung-pen-button-toggle') {
      this.engine.options.samsungButtonToggle = el.checked;
      void db.settings.put({ key: 'samsung-pen-button-toggle', value: el.checked }).catch(report);
      toast(el.checked ? '종이 가까이에서 버튼을 눌렀다 놓으면 펜과 지우개가 바뀌어요.' : '삼성인터넷 버튼 호환을 껐어요.');
    }
    if (el.id === 'eraser-size') {
      this.engine.options.eraserSize = Number(el.value); this.persistEraser();
      this.engine.previewEraserSize();
      const output = this.root.querySelector('#eraser-size-value'); if (output) output.textContent = el.value;
    }
    if (el.id === 'eraser-mode') this.setEraserMode(el.value === 'partial');
    if (el.id === 'hold-to-line') { this.engine.options.holdToLine = el.checked; void db.settings.put({ key: 'hold-to-line', value: el.checked }).catch(report); }
  }
  private setColor(color: string) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    if (this.engine.options.tool === 'text') {
      this.textEditor.setColor(color);
      this.syncColor();
      void db.settings.put({ key: `note-text-color:${this.note.id}`, value: color }).catch(report);
      return;
    }
    this.engine.options.color = color;
    this.syncColor(); this.rememberBrush();
  }
  private activeColor() { return this.engine.options.tool === 'text' ? this.textEditor.color : this.engine.options.color; }
  private syncColor() {
    const color = this.activeColor();
    this.root.querySelector<HTMLElement>('#width-preview')!.style.backgroundColor = color;
    const paletteMatch = this.palette.some(swatch => swatch.toLowerCase() === color.toLowerCase());
    this.root.querySelectorAll<HTMLElement>('[data-action=color]').forEach(e => e.classList.toggle('active', e.dataset.id?.toLowerCase() === color.toLowerCase()));
    const custom = this.root.querySelector<HTMLElement>('.custom-color');
    custom?.classList.toggle('active', !paletteMatch);
    custom?.style.setProperty('--current-color', color);
    if (custom) custom.title = `색상 선택 · 현재 ${color.toUpperCase()}`;
    if (isPenKind(this.engine.options.tool)) this.root.querySelector<HTMLElement>('.pen-tool')?.style.setProperty('--pen-color', color);
  }
  private renderPalette() {
    this.root.querySelectorAll<HTMLElement>('[data-action=color]').forEach((button, index) => {
      button.dataset.id = this.palette[index]; button.style.setProperty('--color', this.palette[index]);
    });
    this.syncColor();
  }
  private setWidth(value: number) {
    if (!Number.isFinite(value)) return;
    const width = this.engine.options.tool === 'highlighter'
      ? Math.max(4, Math.min(32, Math.round(value)))
      : Math.max(.5, Math.min(20, Math.round(value * 2) / 2));
    this.engine.options.width = width;
    this.syncInkControl(); this.rememberBrush();
  }
  private get adjustingDarkness() { return this.engine.options.tool === 'pencil' && this.inkAdjustment === 'darkness'; }
  private setInkValue(value: number) {
    if (!Number.isFinite(value)) return;
    if (this.engine.options.tool === 'text') {
      if (!this.textEditor.active) this.textEditor.open();
      this.textEditor.setSize(value); this.syncInkControl(); return;
    }
    if (!this.adjustingDarkness) { this.setWidth(value); return; }
    this.engine.options.pencilDarkness = Math.max(10, Math.min(100, Math.round(value / 5) * 5)) / 100;
    this.syncInkControl(); this.rememberBrush();
  }
  private persistPencilDarkness() { this.rememberBrush(); }
  private rememberBrush() {
    const tool = this.engine.options.tool; if (!isInkTool(tool)) return;
    // Toolbar changes affect the current stroke only. Saved pen cards are edited in the picker.
    if (isPenKind(tool)) return;
    this.brushes[tool] = { width: this.engine.options.width, color: this.engine.options.color,
      ...(tool === 'highlighter' ? { highlighterWidthVersion: 2 as const } : {}) };
    this.dirtyBrushes.add(tool); clearTimeout(this.brushTimer);
    this.brushTimer = setTimeout(() => { void this.persistBrushes().catch(report); }, 150);
  }
  private persistBrushes() {
    clearTimeout(this.brushTimer);
    const tools = [...this.dirtyBrushes], rows = tools.map(tool => ({ key: `note-brush:${this.note.id}:${tool}`, value: { ...this.brushes[tool] } }));
    this.dirtyBrushes.clear();
    const write = this.brushWrites.then(async () => {
      if (rows.length) await db.settings.bulkPut(rows);
    }).catch(error => { tools.forEach(tool => this.dirtyBrushes.add(tool)); throw error; });
    this.brushWrites = write.catch(() => {}); return write;
  }
  private restoreBrush(tool: InkTool) {
    const profile = isPenKind(tool) ? this.selectedPen() : this.brushes[tool];
    this.engine.options.width = profile.width; this.engine.options.color = profile.color;
    if (tool === 'pencil') { this.engine.options.pencilDarkness = profile.pencilDarkness!; this.inkAdjustment = profile.pencilAdjustment!; }
    this.syncColor(); this.syncInkControl();
  }
  private selectedPen() { return this.pens.presets.find(preset => preset.id === this.pens.selectedId) || this.pens.presets[0]; }
  private rememberPens() {
    this.penDirty = true; clearTimeout(this.penTimer);
    this.penTimer = setTimeout(() => { void this.persistPens().catch(report); }, 180);
  }
  private persistPens() {
    clearTimeout(this.penTimer);
    if (!this.penDirty) return this.penWrites;
    this.penDirty = false;
    const snapshot = structuredClone(this.pens);
    const write = this.penWrites.then(() => db.settings.put({ key: sharedPensKey, value: snapshot }))
      .catch(error => { this.penDirty = true; throw error; });
    this.penWrites = write.then(() => {}).catch(() => {});
    return write;
  }
  private togglePenEraser() {
    if (!isInkTool(this.engine.options.tool) && this.engine.options.tool !== 'eraser') return;
    const tool = this.engine.options.tool === 'eraser' ? this.previousInkTool : 'eraser';
    this.selectTool(tool);
    toast(tool === 'eraser' ? '지우개로 전환했어요. 버튼을 놓고 문질러 주세요.' : '원래 펜으로 돌아왔어요.');
  }
  private persistEraser() { void db.settings.put({ key: 'eraser-settings', value: { partial: this.engine.options.partialEraser, size: this.engine.options.eraserSize } }).catch(report); }
  private setEraserMode(partial: boolean) {
    this.engine.options.partialEraser = partial; this.persistEraser();
    this.root.querySelectorAll('[data-action=eraser-mode]').forEach(button => button.setAttribute('aria-pressed', String((button.getAttribute('data-id') === 'partial') === partial)));
  }
  private renderPenPicker(panel: HTMLElement, mode: 'list' | 'arrange' | 'edit') {
    const heading = `<div class="pen-picker-heading"><strong>${mode === 'edit' ? '펜 설정' : mode === 'arrange' ? '펜 구성' : '저장한 펜'}</strong>${button('X', '펜 메뉴 닫기', 'close-pen')}</div>`;
    if (mode === 'edit' && this.penDraft) {
      const draft = this.penDraft;
      panel.innerHTML = `${heading}<div class="pen-edit-form"><label class="pen-edit-name">이름<input id="pen-edit-name" maxlength="24" value="${escape(draft.name)}" /></label><div class="pen-edit-label">펜 종류</div><div class="pen-edit-kinds">${penKinds.map(kind => `<button type="button" class="pen-edit-kind" data-action="pen-kind" data-id="${kind}" aria-pressed="${kind === draft.tool}">${icon(kind === 'pen' ? 'PenLine' : kind === 'fountain' ? 'Feather' : 'Pencil', 18)}${penNames[kind]}</button>`).join('')}</div><div class="pen-edit-label">색상</div><button type="button" class="pen-edit-color" data-action="pen-color"><span class="pen-edit-color-swatch" style="background-color:${draft.color}"></span><span class="pen-edit-color-value">${draft.color.toUpperCase()}</span>${icon('ChevronRight', 17)}</button><label class="pen-edit-range">굵기 <output class="pen-edit-width-value">${draft.width.toFixed(1)}</output><input id="pen-edit-width" type="range" min="0.5" max="20" step="0.5" value="${draft.width}" /></label><label class="pen-edit-range pen-edit-darkness" ${draft.tool === 'pencil' ? '' : 'hidden'}>진하기 <output class="pen-edit-darkness-value">${Math.round(draft.pencilDarkness * 100)}%</output><input id="pen-edit-darkness" type="range" min="10" max="100" step="5" value="${Math.round(draft.pencilDarkness * 100)}" /></label><div class="pen-picker-actions"><button class="button secondary" type="button" data-action="pen-list">취소</button><button class="button primary" type="button" data-action="pen-save">펜 저장</button></div></div>`;
      return;
    }
    if (mode === 'arrange') {
      panel.innerHTML = `${heading}<p class="pen-picker-help">순서를 바꾸거나 쓰지 않는 펜을 삭제할 수 있어요.</p><div class="pen-picker-list">${this.pens.presets.map((preset, index) => `<div class="pen-arrange-row"><span class="pen-preset-color" style="--preset-color:${preset.color}"></span><span class="pen-arrange-name">${escape(preset.name)}</span><button type="button" data-action="pen-edit" data-id="${preset.id}" aria-label="${escape(preset.name)} 수정">${icon('Pencil', 15)}</button><button type="button" data-action="pen-move" data-id="${preset.id}" data-step="-1" aria-label="${escape(preset.name)} 위로" ${index === 0 ? 'disabled' : ''}>${icon('ArrowUp', 15)}</button><button type="button" data-action="pen-move" data-id="${preset.id}" data-step="1" aria-label="${escape(preset.name)} 아래로" ${index === this.pens.presets.length - 1 ? 'disabled' : ''}>${icon('ArrowDown', 15)}</button><button type="button" data-action="pen-delete" data-id="${preset.id}" aria-label="${escape(preset.name)} 삭제" ${this.pens.presets.length === 1 ? 'disabled' : ''}>${icon('Trash2', 15)}</button></div>`).join('')}</div><div class="pen-picker-actions"><button class="button secondary" type="button" data-action="pen-list">완료</button><button class="button primary" type="button" data-action="pen-add">${icon('Plus', 16)} 펜 추가</button></div>`;
      return;
    }
    panel.innerHTML = `${heading}<div class="pen-picker-hero">${penPreview(this.selectedPen(), 'pen-preview-hero')}</div><div class="pen-picker-list pen-picker-cards">${this.pens.presets.map(preset => `<button type="button" class="pen-preset-row" data-action="pen-select" data-id="${preset.id}" aria-pressed="${preset.id === this.pens.selectedId}" title="${escape(`${penNames[preset.tool]} · ${preset.color.toUpperCase()} · 굵기 ${preset.width.toFixed(1)}${preset.tool === 'pencil' ? ` · 진하기 ${Math.round(preset.pencilDarkness * 100)}%` : ''}`)}"><span class="pen-preset-art">${penPreview(preset)}</span><span class="pen-preset-name" style="--preset-color:${preset.color}">${escape(preset.name)}</span></button>`).join('')}</div><div class="pen-picker-actions"><button class="button secondary" type="button" data-action="pen-arrange">구성 편집</button><button class="button primary" type="button" data-action="pen-add">${icon('Plus', 16)} 펜 추가</button></div>`;
    paintPenPreviews(panel);
  }
  private showPenPicker(anchor: HTMLElement) {
    this.root.querySelector<HTMLElement>('.pen-picker:popover-open')?.hidePopover();
    const panel = document.createElement('div'); panel.id = 'pen-picker'; panel.className = 'pen-picker'; panel.popover = 'manual';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '펜 선택');
    this.renderPenPicker(panel, 'list'); this.root.querySelector('.editor-shell')!.append(panel);
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left - 20, innerWidth - 334))}px`;
    panel.style.top = `${this.root.querySelector('.ink-toolbar')!.getBoundingClientRect().bottom + 6}px`;
    const dismiss = new AbortController();
    this.abort.signal.addEventListener('abort', () => dismiss.abort(), { once: true, signal: dismiss.signal });
    document.addEventListener('pointerdown', event => {
      if (document.querySelector('.color-picker-dialog:popover-open')) return;
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) panel.hidePopover();
    }, { capture: true, signal: dismiss.signal });
    document.addEventListener('keydown', event => {
      if (document.querySelector('.color-picker-dialog:popover-open')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); panel.hidePopover(); }
    }, { capture: true, signal: dismiss.signal });
    panel.addEventListener('toggle', () => {
      const open = panel.matches(':popover-open');
      anchor.setAttribute('aria-expanded', String(open));
      if (!open) { panel.remove(); this.penDraft = undefined; dismiss.abort(); }
    });
    panel.showPopover(); anchor.setAttribute('aria-expanded', 'true');
  }
  private savePenDraft() {
    const draft = this.penDraft; if (!draft) return;
    const panel = this.root.querySelector<HTMLElement>('.pen-picker')!;
    const name = panel.querySelector<HTMLInputElement>('#pen-edit-name')!.value.trim();
    if (!name) { panel.querySelector<HTMLInputElement>('#pen-edit-name')!.focus(); return; }
    draft.name = name.slice(0, 24);
    draft.width = Number(panel.querySelector<HTMLInputElement>('#pen-edit-width')!.value);
    draft.pencilDarkness = Number(panel.querySelector<HTMLInputElement>('#pen-edit-darkness')!.value) / 100;
    const index = this.pens.presets.findIndex(preset => preset.id === draft.id);
    const saved = { ...draft };
    if (index < 0) this.pens.presets.push(saved); else this.pens.presets[index] = saved;
    this.pens.selectedId = draft.id; this.penDraft = undefined;
    this.selectTool(draft.tool); this.rememberPens(); this.renderPenPicker(panel, 'list');
  }
  private movePen(id: string, step: number) {
    const index = this.pens.presets.findIndex(preset => preset.id === id), next = index + step;
    if (index < 0 || next < 0 || next >= this.pens.presets.length) return;
    [this.pens.presets[index], this.pens.presets[next]] = [this.pens.presets[next], this.pens.presets[index]];
    this.rememberPens(); this.renderPenPicker(this.root.querySelector<HTMLElement>('.pen-picker')!, 'arrange');
  }
  private deletePen(id: string) {
    if (this.pens.presets.length < 2) return;
    this.pens.presets = this.pens.presets.filter(preset => preset.id !== id);
    if (this.pens.selectedId === id) {
      this.pens.selectedId = this.pens.presets[0].id; this.selectTool(this.selectedPen().tool);
    }
    this.rememberPens(); this.renderPenPicker(this.root.querySelector<HTMLElement>('.pen-picker')!, 'arrange');
  }
  private syncShapeButton() {
    const choice = shapeChoices.find(choice => choice.id === this.engine.options.shape)!;
    const button = this.root.querySelector<HTMLButtonElement>('[data-action=tool][data-id=shape]')!;
    button.innerHTML = `${shapeIcon(choice.id, 22)}<span>도형</span>`;
    button.title = `도형 · ${choice.name}`;
  }
  private showShapePicker(anchor: HTMLElement) {
    this.root.querySelector<HTMLElement>('.shape-picker:popover-open')?.hidePopover();
    const panel = document.createElement('div'); panel.id = 'shape-picker'; panel.className = 'shape-picker'; panel.popover = 'manual';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '도형 선택');
    panel.innerHTML = `<div class="shape-picker-grid">${shapeChoices.map(choice => `<button type="button" data-action="shape-select" data-id="${choice.id}" aria-label="${choice.name}" title="${choice.name}" aria-pressed="${choice.id === this.engine.options.shape}">${shapeIcon(choice.id, 50)}</button>`).join('')}</div>`;
    this.root.querySelector('.editor-shell')!.append(panel);
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left - 12, innerWidth - 272))}px`;
    panel.style.top = `${this.root.querySelector('.ink-toolbar')!.getBoundingClientRect().bottom + 6}px`;
    const dismiss = new AbortController();
    this.abort.signal.addEventListener('abort', () => dismiss.abort(), { once: true, signal: dismiss.signal });
    document.addEventListener('pointerdown', event => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) panel.hidePopover();
    }, { capture: true, signal: dismiss.signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); panel.hidePopover(); anchor.focus({ preventScroll: true }); }
    }, { capture: true, signal: dismiss.signal });
    panel.addEventListener('toggle', () => {
      const open = panel.matches(':popover-open');
      if (this.root.querySelector('#shape-picker') === panel) anchor.setAttribute('aria-expanded', String(open));
      if (!open) { panel.remove(); dismiss.abort(); }
    });
    panel.showPopover(); anchor.setAttribute('aria-expanded', 'true');
  }
  private showImagePicker(anchor: HTMLElement) {
    this.root.querySelector<HTMLElement>('.image-picker:popover-open')?.hidePopover();
    const panel = document.createElement('div'); panel.id = 'image-picker'; panel.className = 'image-picker'; panel.popover = 'manual';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '사진 추가');
    panel.innerHTML = `<div class="writing-options-heading"><strong>사진 추가</strong>${button('X', '사진 팝업 닫기', 'close-image')}</div><div class="image-picker-actions"><button type="button" data-action="image-upload">${icon('Upload', 21)}<span><strong>사진 선택</strong><small>노트 가운데에 추가</small></span></button></div><p>추가한 사진을 누르면 이동하거나 모서리를 끌어 크기를 조절할 수 있어요.</p><p>PNG, JPG, WebP · 최대 20MB</p>`;
    this.root.querySelector('.editor-shell')!.append(panel);
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left - 12, innerWidth - 292))}px`;
    panel.style.top = `${this.root.querySelector('.ink-toolbar')!.getBoundingClientRect().bottom + 6}px`;
    const dismiss = new AbortController();
    this.abort.signal.addEventListener('abort', () => dismiss.abort(), { once: true, signal: dismiss.signal });
    document.addEventListener('pointerdown', event => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) panel.hidePopover();
    }, { capture: true, signal: dismiss.signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); panel.hidePopover(); anchor.focus({ preventScroll: true }); }
    }, { capture: true, signal: dismiss.signal });
    panel.addEventListener('toggle', () => {
      const open = panel.matches(':popover-open');
      if (this.root.querySelector('#image-picker') === panel) anchor.setAttribute('aria-expanded', String(open));
      if (!open) { panel.remove(); dismiss.abort(); }
    });
    panel.showPopover(); anchor.setAttribute('aria-expanded', 'true');
  }
  private showEraserPicker(anchor: HTMLElement) {
    this.root.querySelector('#eraser-picker')?.remove();
    // Fast pen/touch taps activate on pointerup. Native auto light-dismiss can
    // otherwise close a newly opened popover in that same pointerup event.
    const panel = document.createElement('div'); panel.id = 'eraser-picker'; panel.className = 'eraser-picker'; panel.popover = 'manual';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '지우개 설정');
    panel.innerHTML = `<div class="writing-options-heading"><strong>지우개</strong>${button('X', '지우개 설정 닫기', 'close-eraser')}</div><div class="eraser-modes">${([['stroke', '스트로크 지우개', '닿은 획 전체를 지워요'], ['partial', '펜 지우개', '문지른 부분만 지워요']] as const).map(([id, name, description]) => `<button data-action="eraser-mode" data-id="${id}" aria-label="${name}" aria-pressed="${this.engine.options.partialEraser === (id === 'partial')}">${icon(id === 'stroke' ? 'PenLine' : 'Eraser', 20)}<span><strong>${name}</strong><small>${description}</small></span>${icon('Check', 16)}</button>`).join('')}</div><label class="eraser-size-label" for="eraser-size">지우개 크기 <output id="eraser-size-value">${this.engine.options.eraserSize}</output></label><input id="eraser-size" type="range" min="8" max="100" value="${this.engine.options.eraserSize}" aria-label="지우개 크기"/><p>${isNativeApp ? '화면 가까이에서 S펜 옆 버튼을 누르면 펜과 지우개를 전환해요.' : '측면 버튼을 누른 채 지우기는 기기가 표준 버튼 입력을 전달해야 해요. 삼성인터넷에서는 아래 호환 전환을 사용할 수 있어요.'}</p>`;
    panel.insertAdjacentHTML('beforeend', `<button class="pen-button-help" data-action="pen-button-help" aria-expanded="false" aria-controls="pen-button-guide">${icon('HelpCircle', 15)} 버튼을 누르면 에어 커맨드가 열리나요?</button><p class="pen-button-guide" id="pen-button-guide" hidden><strong>기기 설정 → 유용한 기능 → S펜 → 에어 커맨드</strong>에서 <strong>펜 버튼으로 에어 커맨드 열기</strong>를 꺼 주세요.<br>그다음 버튼을 누른 채 펜촉을 종이에 대고 문질러 주세요. 앱에서 기기의 에어 커맨드 설정을 바꿀 수는 없어요. 꺼도 반응이 없다면 화면의 지우개 버튼을 사용해 주세요. 기기·브라우저에 따라 펜 버튼 입력이 전달되지 않을 수 있어요.</p>`);
    panel.insertAdjacentHTML('beforeend', `<button class="pen-button-help" data-action="pen-button-check">${icon('Move', 15)} S펜 버튼 입력 확인</button>`);
    panel.insertAdjacentHTML('beforeend', isNativeApp
      ? '<p>S펜을 화면 가까이에 두고 옆 버튼을 누르면 펜과 지우개가 전환돼요. 버튼을 놓고 필기해 주세요.</p>'
      : `<label class="finger-switch"><input type="checkbox" id="samsung-pen-button-toggle" ${this.engine.options.samsungButtonToggle ? 'checked' : ''}/><span></span>삼성인터넷 버튼 호환</label><p>종이 가까이에서 펜을 띄운 채 버튼을 한 번 눌렀다 놓으면 펜 ↔ 지우개로 전환해요. 전환 후에는 버튼을 놓고 문질러 주세요.</p>`);
    this.root.querySelector('.editor-shell')!.append(panel);
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 296))}px`;
    panel.style.top = `${this.root.querySelector('.ink-toolbar')!.getBoundingClientRect().bottom + 6}px`;
    const dismiss = new AbortController();
    this.abort.signal.addEventListener('abort', () => dismiss.abort(), { once: true, signal: dismiss.signal });
    document.addEventListener('pointerdown', event => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) panel.hidePopover();
    }, { capture: true, signal: dismiss.signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); panel.hidePopover(); }
    }, { capture: true, signal: dismiss.signal });
    panel.addEventListener('toggle', () => {
      const open = panel.matches(':popover-open');
      if (this.root.querySelector('#eraser-picker') === panel) anchor.setAttribute('aria-expanded', String(open));
      if (!open) { panel.remove(); dismiss.abort(); }
    });
    panel.showPopover(); anchor.setAttribute('aria-expanded', 'true');
  }
  private closePencilMode() {
    const menu = this.root.querySelector<HTMLElement>('#pencil-mode-menu');
    if (menu) menu.hidden = true;
    this.root.querySelector<HTMLButtonElement>('#ink-adjustment')?.setAttribute('aria-expanded', 'false');
  }
  private syncInkControl() {
    const pencil = this.engine.options.tool === 'pencil', darkness = this.adjustingDarkness, text = this.engine.options.tool === 'text';
    const width = this.engine.options.width, value = text ? this.textEditor.size : darkness ? Math.round(this.engine.options.pencilDarkness * 100) : width;
    const highlighter = this.engine.options.tool === 'highlighter';
    const min = text || darkness ? 10 : highlighter ? 4 : .5;
    const max = text || darkness ? 100 : highlighter ? 32 : 20;
    const slider = this.root.querySelector<HTMLInputElement>('#ink-width')!;
    slider.min = String(min); slider.max = String(max); slider.step = text || highlighter ? '1' : darkness ? '5' : '.5'; slider.value = String(value);
    slider.setAttribute('aria-label', text ? '글자 크기' : darkness ? '연필 진하기' : '펜 굵기');
    slider.setAttribute('aria-valuetext', text ? `${value}px` : darkness ? `${value}% · 필압과 관계없이 고정` : width.toFixed(1));
    slider.style.setProperty('--width-progress', `${(value - min) / (max - min) * 100}%`);
    this.root.querySelector<HTMLOutputElement>('#width-value')!.value = text ? String(value) : darkness ? `${value}%` : width.toFixed(1);
    this.root.querySelector<HTMLElement>('#width-preview')!.style.height = `${Math.min(16, width)}px`;
    this.root.querySelector<HTMLElement>('#width-preview')!.hidden = pencil || text;
    this.root.querySelector<HTMLElement>('#width-label')!.hidden = pencil || text;
    const picker = this.root.querySelector<HTMLElement>('.pencil-mode-picker')!;
    picker.hidden = !pencil;
    if (!pencil) this.closePencilMode();
    const mode = this.root.querySelector<HTMLButtonElement>('#ink-adjustment')!;
    const modeName = darkness ? '진하기' : '굵기';
    mode.querySelector('span')!.textContent = modeName;
    mode.setAttribute('aria-label', `연필 조절 항목: ${modeName}`);
    this.root.querySelectorAll<HTMLButtonElement>('[data-action=pencil-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === this.inkAdjustment)));
    this.root.querySelector('.pen-width-control')!.classList.toggle('pencil-controls', pencil);
    for (const [action, delta] of [['pen-thinner', -1], ['pen-thicker', 1]] as const) {
      const button = this.root.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!;
      button.disabled = value === (delta < 0 ? min : max);
      const name = `${text ? '글자 크기' : darkness ? '연필 진하기' : '펜 굵기'} ${delta < 0 ? '줄이기' : '늘리기'}`;
      button.setAttribute('aria-label', name); button.title = name;
    }
  }
  private selectTool(tool: Tool) {
    this.closePencilMode();
    this.root.querySelector<HTMLElement>('.eraser-picker:popover-open')?.hidePopover();
    if (tool !== 'shape') this.root.querySelector<HTMLElement>('.shape-picker:popover-open')?.hidePopover();
    if (tool !== 'image') this.root.querySelector<HTMLElement>('.image-picker:popover-open')?.hidePopover();
    if (!isPenKind(tool)) this.root.querySelector<HTMLElement>('.pen-picker:popover-open')?.hidePopover();
    this.textEditor.finish();
    this.engine.cancel(); this.companionEngine.cancel(); this.engine.clearSelection(); this.companionEngine.clearSelection(); this.engine.options.tool = tool;
    if (isPenKind(tool) && this.selectedPen().tool !== tool) {
      const matching = this.pens.presets.find(preset => preset.tool === tool);
      if (matching) this.pens.selectedId = matching.id;
      else {
        const profile = this.brushes[tool];
        const preset: PenPreset = { id: uid(), name: penNames[tool], tool, color: profile.color, width: profile.width,
          pencilDarkness: profile.pencilDarkness ?? .7, pencilAdjustment: profile.pencilAdjustment ?? 'width' };
        this.pens.presets.push(preset); this.pens.selectedId = preset.id;
      }
      this.rememberPens();
    }
    if (['pen', 'fountain', 'pencil', 'highlighter'].includes(tool)) this.previousInkTool = tool;
    this.root.querySelectorAll<HTMLElement>('[data-action=tool]').forEach(e => { const active = e.dataset.id === tool; e.classList.toggle('active', active); e.setAttribute('aria-pressed', String(active)); });
    const penButton = this.root.querySelector<HTMLButtonElement>('.pen-tool')!;
    penButton.classList.toggle('active', isPenKind(tool)); penButton.setAttribute('aria-pressed', String(isPenKind(tool)));
    const current = this.selectedPen();
    penButton.innerHTML = `${icon(current.tool === 'pen' ? 'PenLine' : current.tool === 'fountain' ? 'Feather' : 'Pencil', 22)}<span>펜</span>`;
    penButton.style.setProperty('--pen-color', current.color);
    this.viewport.classList.toggle('hand-mode', tool === 'hand');
    if (isInkTool(tool)) this.restoreBrush(tool); else { this.syncColor(); this.syncInkControl(); }
    const hints: Record<Tool, string> = { pen: '볼펜 · 일정한 굵기 · 선 끝에서 0.6초 멈추면 직선으로', fountain: '만년필 · 필압과 펜촉 방향에 따라 달라지는 굵기', pencil: '연필 · 굵기와 진하기를 직접 조절 · 필압과 관계없이 고정', highlighter: '형광펜 · 펜과 별도 굵기 · 4~32', eraser: '지우개 · 원으로 지우는 범위 표시 · S펜 버튼 안내는 지우개 설정에서', lasso: '올가미 · 둘러싸서 선택한 다음 드래그로 이동', shape: '도형 · 드래그로 반듯한 도형 그리기', text: '타이핑 · 손글씨와 관계없이 페이지 여백 안에서 이어 쓰기 · 본문과 별도 글상자 전환', image: '사진 · 팝업에서 추가 · 사진을 눌러 이동하고 모서리로 크기 조절', hand: '이동 · 드래그로 종이 이동, 두 손가락으로 확대' };
    this.toolHint = hints[tool];
    if (tool === 'text' && this.page && !this.switching && this.textEditor.mode === 'document') this.textEditor.open();
  }
  private contextOptions() {
    const tool = this.engine.options.tool;
    return tool === 'eraser' ? `<select id="eraser-mode" aria-label="지우개 모드"><option value="stroke" ${!this.engine.options.partialEraser ? 'selected' : ''}>스트로크 지우개</option><option value="partial" ${this.engine.options.partialEraser ? 'selected' : ''}>펜 지우개</option></select><input id="eraser-size" type="range" min="8" max="100" value="${this.engine.options.eraserSize}" aria-label="지우개 크기"/>` : tool === 'pen' ? '<p>볼펜은 필압과 관계없이 설정한 굵기를 유지해요.</p>' : tool === 'lasso' ? `<button class="text-button" data-action="selection-paste">${icon('Copy', 14)} 붙여넣기</button>` : '';
  }
  private insert(point: Point, tool: Tool) {
    if (tool === 'text') {
      this.textEditor.open(point);
    }
  }
  private async addImage(file: File, page: Page, point?: Point) {
    if (file.size > 20 * 1024 * 1024) throw new Error('이미지는 20MB 이하로 추가해 주세요.');
    const img = new Image(), url = URL.createObjectURL(file);
    try {
      img.src = url; await img.decode();
      if (img.width * img.height > 40000000) throw new Error('이미지 해상도가 너무 커요. 크기를 줄여 주세요.');
      if (this.page !== page) return;
      const id = uid(); await db.assets.add({ id, noteId: this.note.id, blob: file, name: file.name });
      const w = Math.min(img.width, page.width * .65, img.width * page.height * .65 / img.height);
      const h = w * img.height / img.width;
      const item: Item = { id: uid(), kind: 'image', assetId: id,
        x: point?.x ?? (page.width - w) / 2, y: point?.y ?? (page.height - h) / 2, w, h };
      page.items.push(item);
      try { await loadImages(page); }
      catch (error) { await db.assets.delete(id); throw error; }
      finally { const index = page.items.indexOf(item); if (index !== -1) page.items.splice(index, 1); }
      if (this.page !== page) { await db.assets.delete(id); return; }
      this.engine.mutate(() => page.items.push(item));
      this.focusEngine(this.engine); this.engine.selectImage(item.id);
    } finally { URL.revokeObjectURL(url); }
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
    if (e.key === 'Escape' && !this.root.querySelector<HTMLElement>('#view-options-panel')?.hidden) {
      e.preventDefault(); this.closeViewOptions(); this.root.querySelector<HTMLButtonElement>('[data-action=view-options]')?.focus({ preventScroll: true }); return;
    }
    if (e.key === 'Escape' && !this.root.querySelector<HTMLElement>('#pencil-mode-menu')?.hidden) {
      e.preventDefault(); this.closePencilMode(); this.root.querySelector<HTMLButtonElement>('#ink-adjustment')?.focus({ preventScroll: true }); return;
    }
    if (e.key === 'F5' || (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault(); toast('필기 화면에서는 새로고침을 막았어요. 서재로 돌아가거나 설정에서 업데이트해 주세요.'); return;
    }
    if ((e.target as Element).matches('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.editingEngine.redo() : this.editingEngine.undo(); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.editingEngine.redo(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); run(() => this.flush()); }
    if (mod && e.key.toLowerCase() === 'c' && this.editingEngine.selected.size) { e.preventDefault(); this.editingEngine.selectionAction('copy'); toast('선택을 복사했어요.'); }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); this.editingEngine.selectionAction('paste'); }
    if (e.key === 'Delete' || e.key === 'Backspace') this.editingEngine.selectionAction('delete');
    if (e.key === 'Escape') this.editingEngine.clearSelection();
    if (!mod && e.key.toLowerCase() === 'p') this.selectTool('pen');
    if (!mod && e.key.toLowerCase() === 'e') this.selectTool('eraser');
    if (!mod && e.key.toLowerCase() === 'h') this.selectTool('hand');
  }
  private setupGestures() {
    const signal = this.abort.signal;
    this.viewport.addEventListener('pointerdown', e => {
      if (e.defaultPrevented && (this.engine.activePointer !== null || this.companionEngine.activePointer !== null)) return;
      const onSpreadButton = !!(e.target as Element).closest('.spread-empty');
      const inText = !!(e.target as Element).closest('.inline-text-box');
      if (inText && e.pointerType !== 'touch' || this.engine.options.tool === 'text' && e.defaultPrevented) return;
      if (e.pointerType === 'pen' && this.engine.options.tool !== 'hand') return;
      if (e.pointerType === 'touch') {
        if (this.palmGuard.rejectTouch(e)) return;
        if ((this.engine.activePointer !== null || this.companionEngine.activePointer !== null) && !this.engine.options.fingerDrawing) return;
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size === 2) {
          this.cancelViewportUpdate(); this.viewport.classList.add('zoom-preview');
          this.detail.suspend(); this.companionDetail.suspend();
          this.engine.cancel(); this.companionEngine.cancel(); const [a, b] = [...this.touches.values()], r = this.viewport.getBoundingClientRect();
          this.pinch = { distance: Math.hypot(b.x - a.x, b.y - a.y), scale: this.scale, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
            scrollX: this.viewport.scrollLeft, scrollY: this.viewport.scrollTop, centerX: (a.x + b.x) / 2 - r.left, centerY: (a.y + b.y) / 2 - r.top };
          this.pan = null;
        }
      }
      if (inText && this.touches.size < 2) return;
      if ((e.pointerType === 'touch' && !this.engine.options.fingerDrawing && this.touches.size === 1) || this.engine.options.tool === 'hand') {
        if (onSpreadButton) return;
        this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.viewport.scrollLeft, top: this.viewport.scrollTop };
        this.viewport.setPointerCapture(e.pointerId);
      }
    }, { signal });
    this.viewport.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' && this.palmGuard.rejectTouch(e)) {
        this.touches.delete(e.pointerId);
        if (this.pan?.id === e.pointerId) {
          this.viewport.scrollLeft = this.pan.left; this.viewport.scrollTop = this.pan.top; this.pan = null;
        }
        if (this.pinch) {
          const p = this.pinch; this.pinch = null; this.zoom(p.scale);
          this.viewport.scrollLeft = p.scrollX; this.viewport.scrollTop = p.scrollY;
        }
        return;
      }
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
        if (!this.viewport.classList.contains('zoom-preview')) {
          this.engine.cancel(); this.companionEngine.cancel();
          this.detail.suspend(); this.companionDetail.suspend();
        }
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
  private setStudyPanel(mode: 'browser' | 'ai' | null) {
    this.studyPanel = mode;
    if (!mode) this.studyPanelOccluded = false;
    const shell = this.root.querySelector<HTMLElement>('.editor-shell');
    shell?.classList.toggle('study-browser-open', !!mode);
    if (shell) shell.dataset.studyPanel = mode || 'none';
    this.root.querySelector('[data-action=study-browser]')?.setAttribute('aria-expanded', String(mode === 'browser'));
    this.root.querySelector('[data-action=study-ai]')?.setAttribute('aria-expanded', String(mode === 'ai'));
  }
  private syncStudyPanelOverlay() {
    if (!this.studyPanel) return;
    const hidden = !!document.querySelector('dialog[open]');
    if (hidden === this.studyPanelOccluded) return;
    this.studyPanelOccluded = hidden;
    void setNativeStudyPanelOccluded(hidden).catch(report);
  }
  private async closeStudyPanel() {
    const previous = this.studyPanel;
    this.setStudyPanel(null);
    try { await closeNativeStudyPanel(); }
    catch (error) { this.setStudyPanel(previous); throw error; }
  }
  private async toggleStudyPanel(mode: 'browser' | 'ai') {
    if (this.studyPanel === mode) return this.closeStudyPanel();
    const previous = this.studyPanel;
    this.setStudyPanel(mode);
    try {
      if (mode === 'ai') await openNativeStudyAI(this.note.id, this.aiProvider);
      else await openNativeStudyBrowser(this.note.id);
      this.syncStudyPanelOverlay();
    } catch (error) { this.setStudyPanel(previous); throw error; }
  }
  destroy() { this.studyTimer?.destroy(); this.studyBrowserObserver?.disconnect(); if (this.studyPanel) void closeNativeStudyPanel().catch(console.error); this.textEditor?.destroy(); this.previews?.destroy(); this.detail?.destroy(); this.companionDetail?.destroy(); this.cancelViewportUpdate(); clearTimeout(this.thumbTimer); clearTimeout(this.temporaryNoticeTimer); clearTimeout(this.companionThumbTimer); clearTimeout(this.brushTimer); clearTimeout(this.penTimer); this.generation++; this.spreadGeneration++; this.engine?.destroy(); this.companionEngine?.destroy(); this.abort.abort(); this.resizeObserver?.disconnect(); }
}
