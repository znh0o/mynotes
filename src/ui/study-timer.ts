import { db } from '../data/store';
import { button, escape, icon, report, toast } from './common';

type Preset = { id: string; name: string; seconds: number };
type TimerState = { name: string; seconds: number; remaining: number; endsAt: number | null; finished: boolean };

const presetsKey = 'study-timer-presets';
const stateKey = 'study-timer-state';
const maximumSeconds = 24 * 60 * 60 - 1;
const validSeconds = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0 && Number(value) <= maximumSeconds;
const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
};
const readPreset = (value: unknown): Preset | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<Preset>;
  return typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim() && validSeconds(item.seconds)
    ? { id: item.id, name: item.name.trim().slice(0, 40), seconds: item.seconds } : null;
};
const readState = (value: unknown): TimerState | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<TimerState>;
  if (typeof item.name !== 'string' || !validSeconds(item.seconds) || typeof item.remaining !== 'number' || !Number.isFinite(item.remaining)) return null;
  return {
    name: item.name.slice(0, 40), seconds: item.seconds,
    remaining: Math.max(0, Math.min(item.seconds, item.remaining)),
    endsAt: typeof item.endsAt === 'number' && Number.isFinite(item.endsAt) ? item.endsAt : null,
    finished: item.finished === true,
  };
};

export class StudyTimer {
  private presets: Preset[] = [];
  private selectedId: string | null = null;
  private state: TimerState | null = null;
  private trigger: HTMLButtonElement;
  private mini: HTMLElement;
  private panel: HTMLElement;
  private interval?: ReturnType<typeof setInterval>;
  private writes = Promise.resolve();
  private abort = new AbortController();

  constructor(private root: HTMLElement) {
    const viewButton = root.querySelector<HTMLElement>('[data-action=view-options]')!;
    viewButton.insertAdjacentHTML('beforebegin', button('Clock', '타이머', 'timer', 'aria-haspopup="true" aria-expanded="false" aria-controls="study-timer-panel"'));
    this.trigger = root.querySelector<HTMLButtonElement>('[data-action=timer]')!;
    this.trigger.classList.add('study-timer-trigger');
    root.querySelector('.editor-page-controls')!.insertAdjacentHTML('afterend', `<div class="study-timer-mini" role="group" aria-label="실행 중인 타이머" hidden><button type="button" class="study-timer-mini-time" data-timer-action="open" aria-label="타이머 열기">${icon('Clock', 14)}<span>25:00</span></button><button type="button" class="study-timer-mini-toggle" data-timer-action="mini-toggle" aria-label="일시정지" title="일시정지">${icon('Pause', 14)}</button></div>`);
    this.mini = root.querySelector<HTMLElement>('.study-timer-mini')!;
    root.querySelector('.editor-header')!.insertAdjacentHTML('beforeend', `<section class="study-timer-panel" id="study-timer-panel" aria-label="타이머" hidden>
      <div class="study-timer-heading"><strong>타이머</strong><button type="button" data-timer-action="close" aria-label="타이머 닫기">${icon('X', 17)}</button></div>
      <div class="study-timer-clock" aria-live="off">25:00</div><div class="study-timer-status" role="status">시간을 정하고 시작하세요</div>
      <label class="study-timer-label" for="study-timer-name">이름</label><input id="study-timer-name" class="study-timer-name" type="text" maxlength="40" autocomplete="off" placeholder="예: 국어 공부" />
      <div class="study-timer-duration"><label>시간<input type="number" id="study-timer-hours" min="0" max="23" value="0" inputmode="numeric" /></label><span>:</span><label>분<input type="number" id="study-timer-minutes" min="0" max="59" value="25" inputmode="numeric" /></label><span>:</span><label>초<input type="number" id="study-timer-seconds" min="0" max="59" value="0" inputmode="numeric" /></label></div>
      <div class="study-timer-controls"><button type="button" class="study-timer-main" data-timer-action="start">시작</button><button type="button" data-timer-action="pause" hidden>일시정지</button><button type="button" data-timer-action="reset">초기화</button></div>
      <div class="study-timer-saved-heading"><strong>저장한 타이머</strong><button type="button" data-timer-action="save">${icon('Plus', 14)} 저장</button></div><div class="study-timer-presets"></div>
    </section>`);
    this.panel = root.querySelector<HTMLElement>('#study-timer-panel')!;
    this.trigger.addEventListener('click', () => this.toggle(), { signal: this.abort.signal });
    this.mini.addEventListener('click', event => { const action = (event.target as Element).closest<HTMLElement>('[data-timer-action]'); if (action) void this.act(action); }, { signal: this.abort.signal });
    this.panel.addEventListener('click', event => { const action = (event.target as Element).closest<HTMLElement>('[data-timer-action]'); if (action) void this.act(action); }, { signal: this.abort.signal });
    this.panel.addEventListener('input', event => { if ((event.target as Element).matches('.study-timer-duration input')) this.renderClock(); }, { signal: this.abort.signal });
    document.addEventListener('pointerdown', event => {
      if (!this.panel.hidden && !this.panel.contains(event.target as Node) && !this.trigger.contains(event.target as Node)) this.close();
    }, { signal: this.abort.signal });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !this.panel.hidden) { event.preventDefault(); this.close(); this.trigger.focus({ preventScroll: true }); } }, { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(); }, { signal: this.abort.signal });
  }

  async start() {
    const [savedPresets, savedState] = await Promise.all([db.settings.get(presetsKey), db.settings.get(stateKey)]);
    this.presets = Array.isArray(savedPresets?.value) ? savedPresets.value.map(readPreset).filter((preset): preset is Preset => preset !== null).slice(0, 50) : [];
    this.state = readState(savedState?.value);
    if (this.state) this.setInputs(this.state.name, this.state.seconds);
    this.renderPresets(); this.tick();
    this.interval = setInterval(() => this.tick(), 1000);
  }

  private input<T extends HTMLInputElement>(id: string): T { return this.panel.querySelector<T>(`#${id}`)!; }
  private duration(): number | null {
    const values = ['study-timer-hours', 'study-timer-minutes', 'study-timer-seconds'].map(id => Number(this.input(id).value));
    if (values.some((value, index) => !Number.isInteger(value) || value < 0 || value > (index ? 59 : 23))) return null;
    const total = values[0] * 3600 + values[1] * 60 + values[2];
    return validSeconds(total) ? total : null;
  }
  private setInputs(name: string, seconds: number) {
    this.input('study-timer-name').value = name;
    this.input('study-timer-hours').value = String(Math.floor(seconds / 3600));
    this.input('study-timer-minutes').value = String(Math.floor(seconds % 3600 / 60));
    this.input('study-timer-seconds').value = String(seconds % 60);
  }
  private persist(key: string, value: unknown) {
    this.writes = this.writes.then(() => db.settings.put({ key, value })).then(() => {}, report);
  }
  private toggle() { this.panel.hidden ? this.open() : this.close(); }
  private open() { this.panel.hidden = false; this.trigger.setAttribute('aria-expanded', 'true'); this.tick(); }
  private close() { this.panel.hidden = true; this.trigger.setAttribute('aria-expanded', 'false'); this.renderClock(); }

  private tick() {
    if (this.state?.endsAt !== null && this.state?.endsAt !== undefined) {
      const remaining = Math.max(0, Math.ceil((this.state.endsAt - Date.now()) / 1000));
      if (remaining === 0) {
        const name = this.state.name;
        this.state = { ...this.state, remaining: 0, endsAt: null, finished: true };
        this.persist(stateKey, this.state);
        toast(`${name} 타이머가 끝났어요.`);
        navigator.vibrate?.([150, 100, 150]);
      }
    }
    this.renderClock();
  }
  private renderClock() {
    const state = this.state;
    const remaining = state?.endsAt ? Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000)) : state?.remaining ?? this.duration() ?? 1500;
    const running = !!state?.endsAt;
    this.panel.querySelector<HTMLElement>('.study-timer-clock')!.textContent = formatTime(remaining);
    this.panel.querySelector<HTMLElement>('.study-timer-status')!.textContent = state?.finished ? `${state.name} · 완료` : running ? `${state!.name} · 진행 중` : state ? `${state.name} · ${state.remaining < state.seconds ? '일시정지' : '시작 대기'}` : '시간을 정하고 시작하세요';
    this.panel.querySelector<HTMLButtonElement>('[data-timer-action=pause]')!.hidden = !running;
    const start = this.panel.querySelector<HTMLButtonElement>('[data-timer-action=start]')!;
    start.textContent = state && !state.finished && !running && state.remaining < state.seconds ? '계속' : running ? '다시 시작' : '시작';
    this.trigger.classList.toggle('is-running', running);
    this.trigger.setAttribute('aria-label', running ? `타이머 ${formatTime(remaining)} 남음` : '타이머');
    this.trigger.title = running ? `${state!.name} · ${formatTime(remaining)} 남음` : '타이머';
    this.mini.hidden = !state || state.finished || !this.panel.hidden;
    this.mini.querySelector<HTMLElement>('.study-timer-mini-time span')!.textContent = formatTime(remaining);
    const toggle = this.mini.querySelector<HTMLButtonElement>('.study-timer-mini-toggle')!;
    toggle.innerHTML = icon(running ? 'Pause' : 'Play', 14);
    toggle.setAttribute('aria-label', running ? '타이머 일시정지' : '타이머 계속');
    toggle.title = running ? '타이머 일시정지' : '타이머 계속';
  }
  private renderPresets() {
    const list = this.panel.querySelector<HTMLElement>('.study-timer-presets')!;
    list.innerHTML = this.presets.length ? this.presets.map(preset => `<div class="study-timer-preset ${preset.id === this.selectedId ? 'selected' : ''}"><button type="button" data-timer-action="select" data-id="${escape(preset.id)}"><span>${escape(preset.name)}</span><small>${formatTime(preset.seconds)}</small></button><button type="button" class="study-timer-delete" data-timer-action="delete" data-id="${escape(preset.id)}" aria-label="${escape(preset.name)} 삭제">${icon('Trash2', 15)}</button></div>`).join('') : '<p>저장한 타이머가 없어요.</p>';
  }
  private async act(target: HTMLElement) {
    const action = target.dataset.timerAction;
    if (action === 'close') return this.close();
    if (action === 'open') return this.open();
    if (action === 'mini-toggle' && this.state) {
      if (this.state.endsAt) {
        this.state = { ...this.state, remaining: Math.max(0, Math.ceil((this.state.endsAt - Date.now()) / 1000)), endsAt: null };
      } else {
        this.state = { ...this.state, remaining: this.state.remaining || this.state.seconds, endsAt: Date.now() + (this.state.remaining || this.state.seconds) * 1000, finished: false };
      }
      this.persist(stateKey, this.state); this.renderClock(); return;
    }
    if (action === 'select') {
      const preset = this.presets.find(item => item.id === target.dataset.id);
      if (!preset) return;
      this.selectedId = preset.id; this.setInputs(preset.name, preset.seconds); this.renderPresets(); return;
    }
    if (action === 'delete') {
      this.presets = this.presets.filter(item => item.id !== target.dataset.id);
      if (this.selectedId === target.dataset.id) this.selectedId = null;
      this.persist(presetsKey, this.presets); this.renderPresets(); return;
    }
    if (action === 'save') {
      const seconds = this.duration(), name = this.input('study-timer-name').value.trim();
      if (!name || seconds === null) return toast('이름과 1초 이상의 시간을 입력해 주세요.', true);
      if (!this.selectedId && this.presets.length >= 50) return toast('타이머는 최대 50개까지 저장할 수 있어요.', true);
      const id = this.selectedId ?? crypto.randomUUID();
      const preset = { id, name: name.slice(0, 40), seconds };
      const index = this.presets.findIndex(item => item.id === id);
      if (index >= 0) this.presets[index] = preset; else this.presets.push(preset);
      this.selectedId = id; this.persist(presetsKey, this.presets); this.renderPresets(); toast(`${preset.name} 타이머를 저장했어요.`); return;
    }
    if (action === 'pause' && this.state?.endsAt) {
      this.state = { ...this.state, remaining: Math.max(0, Math.ceil((this.state.endsAt - Date.now()) / 1000)), endsAt: null };
      this.persist(stateKey, this.state); this.renderClock(); return;
    }
    if (action === 'reset') {
      if (!this.state) return;
      this.state = { ...this.state, remaining: this.state.seconds, endsAt: null, finished: false };
      this.persist(stateKey, this.state); this.renderClock(); return;
    }
    if (action === 'start') {
      const seconds = this.duration();
      if (seconds === null) return toast('1초 이상, 24시간 미만으로 시간을 입력해 주세요.', true);
      const name = this.input('study-timer-name').value.trim().slice(0, 40) || '타이머';
      const resume = this.state && !this.state.finished && !this.state.endsAt && this.state.name === name && this.state.seconds === seconds && this.state.remaining < seconds;
      const remaining = resume ? this.state!.remaining : seconds;
      this.state = { name, seconds, remaining, endsAt: Date.now() + remaining * 1000, finished: false };
      this.persist(stateKey, this.state); this.renderClock();
    }
  }
  destroy() { this.abort.abort(); clearInterval(this.interval); this.panel.remove(); this.mini.remove(); this.trigger.remove(); }
}
