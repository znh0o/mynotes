import { db } from '../data/store';
import { examPresets, type ExamPreset } from '../data/exam-presets';
import { button, escape, icon, modal, report, toast } from './common';

interface ExamSession { presetId: string; name: string; seconds: number; endsAt: number }
const presetsKey = 'exam-mode-presets';
const validSeconds = (seconds: unknown): seconds is number => Number.isInteger(seconds) && Number(seconds) >= 60 && Number(seconds) <= 24 * 3600;
const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

export class ExamMode {
  private presets: ExamPreset[] = [];
  private session?: ExamSession;
  private timer?: ReturnType<typeof setInterval>;
  private abort = new AbortController();
  private toolbar: HTMLElement;
  private trigger: HTMLButtonElement;
  private expired = false;

  constructor(private root: HTMLElement, private noteId: string,
    private onTool: (tool: 'pencil' | 'eraser' | 'hand') => void,
    private onExit: () => void) {
    const header = root.querySelector<HTMLElement>('.editor-header-actions')!;
    header.insertAdjacentHTML('afterbegin', button('ClipboardCheck', '시험 모드', 'exam-open'));
    this.trigger = header.querySelector<HTMLButtonElement>('[data-action=exam-open]')!;
    this.trigger.classList.add('exam-entry');
    this.trigger.insertAdjacentHTML('beforeend', '<span class="exam-entry-label" aria-hidden="true">시험</span>');
    this.trigger.addEventListener('click', () => this.openSetup(), { signal: this.abort.signal });
    root.querySelector<HTMLElement>('.editor-shell')!.insertAdjacentHTML('afterbegin',
      `<div class="exam-toolbar" role="toolbar" aria-label="시험 모드 도구" hidden>
        <button type="button" class="exam-leave" data-exam-action="exit">${icon('ChevronLeft', 17)}<span>나가기</span></button>
        <strong class="exam-title"></strong>
        <div class="exam-tools"><button type="button" data-exam-action="pencil" aria-pressed="true">${icon('Pencil', 19)}<span>연필</span></button><button type="button" data-exam-action="eraser" aria-pressed="false">${icon('Eraser', 19)}<span>지우개</span></button></div>
        <div class="exam-clock" role="timer" aria-live="off">${icon('Clock', 16)}<span>00:00</span></div>
      </div>`);
    this.toolbar = root.querySelector<HTMLElement>('.exam-toolbar')!;
    this.toolbar.addEventListener('click', event => {
      const action = (event.target as Element).closest<HTMLElement>('[data-exam-action]')?.dataset.examAction;
      if (action === 'exit') void this.exit().catch(report);
      if (action === 'pencil' || action === 'eraser') this.select(action);
    }, { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(); }, { signal: this.abort.signal });
  }

  get active() { return !!this.session; }

  async load() {
    const [saved, active] = await Promise.all([db.settings.get(presetsKey), db.settings.get(`exam-mode-state:${this.noteId}`)]);
    this.presets = examPresets(saved?.value);
    const state = active?.value as Partial<ExamSession> | undefined;
    if (state && typeof state.presetId === 'string' && typeof state.name === 'string' && validSeconds(state.seconds)
      && typeof state.endsAt === 'number' && Number.isFinite(state.endsAt)) {
      this.session = { presetId: state.presetId, name: state.name.slice(0, 40), seconds: state.seconds, endsAt: state.endsAt };
      this.enter();
    }
  }

  private openSetup() {
    if (this.active) return;
    let selectedId: string | null = null;
    const dialog = modal('시험 모드', `<p class="exam-help">시험 이름과 시간을 정하면 연필·지우개·타이머만 표시돼요. 저장한 시험은 다음에도 사용할 수 있어요.</p>
      <div class="exam-saved-heading">저장한 시험</div><div class="exam-presets"></div>
      <label class="form-label">시험 이름<input name="exam-name" maxlength="40" value="새 시험" required autocomplete="off"></label>
      <label class="form-label">시험 시간 (분)<input name="exam-minutes" type="number" min="1" max="1440" value="60" required inputmode="numeric"></label>
      <button type="button" class="button secondary exam-save" data-exam-dialog="save">이 설정 저장</button>`, '시험 시작', async (form) => {
      const preset = readForm(form);
      if (!selectedId && this.presets.length >= 30) throw new Error('시험 설정은 최대 30개까지 저장할 수 있어요.');
      const id = selectedId ?? crypto.randomUUID();
      await this.savePreset({ id, ...preset });
      this.session = { presetId: id, ...preset, endsAt: Date.now() + preset.seconds * 1000 };
      await db.settings.put({ key: `exam-mode-state:${this.noteId}`, value: this.session });
      this.enter();
    });
    dialog.classList.add('exam-setup');
    dialog.setAttribute('aria-label', '시험 모드');
    const name = dialog.querySelector<HTMLInputElement>('[name=exam-name]')!;
    const minutes = dialog.querySelector<HTMLInputElement>('[name=exam-minutes]')!;
    const renderPresets = () => {
      dialog.querySelector<HTMLElement>('.exam-presets')!.innerHTML = this.presets.length
        ? this.presets.map(preset => `<div class="exam-preset"><button type="button" data-exam-dialog="select" data-id="${escape(preset.id)}" aria-pressed="${selectedId === preset.id}"><span>${escape(preset.name)}</span><small>${clock(preset.seconds)}</small></button><button type="button" data-exam-dialog="delete" data-id="${escape(preset.id)}" aria-label="${escape(preset.name)} 삭제">${icon('Trash2', 15)}</button></div>`).join('')
        : '<p class="exam-empty">저장한 시험이 없어요.</p>';
    };
    renderPresets();
    dialog.addEventListener('click', event => {
      const target = (event.target as Element).closest<HTMLElement>('[data-exam-dialog]');
      if (!target) return;
      const action = target.dataset.examDialog;
      if (action === 'select') {
        const preset = this.presets.find(item => item.id === target.dataset.id);
        if (!preset) return;
        selectedId = preset.id; name.value = preset.name; minutes.value = String(preset.seconds / 60); renderPresets();
      }
      if (action === 'delete') void (async () => {
        this.presets = this.presets.filter(item => item.id !== target.dataset.id);
        if (selectedId === target.dataset.id) selectedId = null;
        await db.settings.put({ key: presetsKey, value: this.presets }); renderPresets();
      })().catch(report);
      if (action === 'save') void (async () => {
        const preset = readForm(new FormData(dialog.querySelector('form')!));
        if (!selectedId && this.presets.length >= 30) throw new Error('시험 설정은 최대 30개까지 저장할 수 있어요.');
        selectedId ??= crypto.randomUUID();
        await this.savePreset({ id: selectedId, ...preset }); renderPresets(); toast('시험 설정을 저장했어요.');
      })().catch(report);
    });
  }

  private async savePreset(preset: ExamPreset) {
    const index = this.presets.findIndex(item => item.id === preset.id);
    if (index < 0) this.presets.push(preset); else this.presets[index] = preset;
    await db.settings.put({ key: presetsKey, value: this.presets });
  }

  private enter() {
    if (!this.session) return;
    this.root.querySelector<HTMLElement>('.editor-shell')!.classList.add('exam-active');
    this.toolbar.hidden = false;
    this.toolbar.querySelector<HTMLElement>('.exam-title')!.textContent = this.session.name;
    this.select('pencil');
    this.tick();
    clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 1000);
  }

  private select(tool: 'pencil' | 'eraser') {
    if (!this.session || this.expired) return;
    this.onTool(tool);
    this.toolbar.querySelectorAll<HTMLElement>('[data-exam-action=pencil],[data-exam-action=eraser]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.examAction === tool)));
  }

  private tick() {
    if (!this.session) return;
    const remaining = Math.max(0, Math.ceil((this.session.endsAt - Date.now()) / 1000));
    this.toolbar.querySelector<HTMLElement>('.exam-clock span')!.textContent = remaining ? clock(remaining) : '시간 종료';
    if (!remaining && !this.expired) {
      this.expired = true;
      this.root.querySelector<HTMLElement>('.editor-shell')!.classList.add('exam-expired');
      this.onTool('hand');
      toast(`${this.session.name} 시간이 끝났어요.`);
      navigator.vibrate?.([150, 100, 150]);
      clearInterval(this.timer);
    }
  }

  async exit() {
    await db.settings.delete(`exam-mode-state:${this.noteId}`);
    this.session = undefined; this.expired = false;
    clearInterval(this.timer); this.toolbar.hidden = true;
    this.root.querySelector<HTMLElement>('.editor-shell')!.classList.remove('exam-active', 'exam-expired');
    this.onExit();
  }

  destroy() { this.abort.abort(); clearInterval(this.timer); this.toolbar.remove(); this.trigger.remove(); }
}

function readForm(form: FormData) {
  const name = String(form.get('exam-name') || '').trim().slice(0, 40);
  const minutes = Number(form.get('exam-minutes'));
  if (!name || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('시험 이름과 1~1440분의 시간을 입력해 주세요.');
  return { name, seconds: minutes * 60 };
}
