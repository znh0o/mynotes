import { modal, run, toast } from './common';
import { version } from '../../package.json';
import { primaryHoverPress } from '../engine/pen-input';
import { isNativeApp } from '../platform/native';

export function showPenCheck() {
  const dialog = modal('S펜 버튼 입력 확인', `<p class="dialog-description">아래 칸에서 평소처럼 한 번 그린 다음, S펜 버튼을 누른 채 다시 그어 보세요.</p><div class="pen-check-pad" tabindex="0" aria-label="S펜 입력 확인 영역">이 안에서 S펜으로 테스트하세요</div><p class="pen-check-status" role="status" aria-live="polite">S펜 입력을 기다리고 있어요.</p><div class="pen-check-actions"><button type="button" class="button secondary" data-pen-check="finish">버튼을 누르고 테스트했어요</button><button type="button" class="button secondary" data-pen-check="copy">진단 결과 복사</button></div><p class="muted">결과를 복사해 알려주시면 버튼 신호가 전달되는지 확인할 수 있어요. 실제 노트에는 그려지지 않습니다.</p>`, '닫기', () => {});
  dialog.querySelector('footer [data-close]')?.remove();
  dialog.setAttribute('aria-label', 'S펜 버튼 입력 확인');
  const pad = dialog.querySelector<HTMLElement>('.pen-check-pad')!, status = dialog.querySelector('.pen-check-status')!;
  let penSeen = false, buttonSeen = false, primaryHoverSeen = false, nativeButtonSeen = false, checked = false;
  const events: { type: string; pointerType: string; button: number; buttons: number; pressure: number; contact: boolean }[] = [];
  const update = () => {
    const message = buttonSeen ? '버튼 신호를 받았어요. 진단 결과를 복사해 알려주세요.' : !penSeen ? 'S펜 입력을 기다리고 있어요.'
      : primaryHoverSeen ? '호환 전환 입력을 감지했어요. 삼성인터넷 버튼 호환을 켜고, 버튼을 눌렀다 놓은 뒤 문질러 보세요.'
      : checked ? '펜 입력은 오지만 버튼 신호는 아직 확인되지 않았어요. 진단 결과를 복사해 알려주세요.' : 'S펜을 감지했어요. 버튼을 누른 채 다시 그어 보세요.';
    if (status.textContent !== message) status.textContent = message;
    status.classList.toggle('detected', buttonSeen);
  };
  const observe = (event: PointerEvent) => {
    event.preventDefault();
    if (event.pointerType === 'pen') {
      penSeen = true;
      if ((event.buttons & 34) !== 0 || [2, 5].includes(event.button)) buttonSeen = true;
      if (primaryHoverPress(event)) primaryHoverSeen = true;
    }
    const sample = { type: event.type, pointerType: event.pointerType, button: event.button, buttons: event.buttons, pressure: event.pressure, contact: event.pressure > 0 };
    const previous = events[events.length - 1];
    if (!previous || previous.type !== sample.type || previous.pointerType !== sample.pointerType || previous.button !== sample.button || previous.buttons !== sample.buttons || previous.contact !== sample.contact) {
      if (events.length >= 60) events.shift(); events.push(sample);
    }
    update();
    if (event.type === 'pointerdown') pad.setPointerCapture(event.pointerId);
  };
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) pad.addEventListener(type, observe);
  if (isNativeApp) {
    const nativeButton = () => { nativeButtonSeen = true; buttonSeen = true; penSeen = true; update(); };
    window.addEventListener('notelin-native-stylus-button', nativeButton);
    dialog.addEventListener('close', () => window.removeEventListener('notelin-native-stylus-button', nativeButton), { once: true });
  }
  pad.addEventListener('contextmenu', event => event.preventDefault());
  dialog.querySelector('[data-pen-check=finish]')!.addEventListener('click', () => { checked = true; update(); });
  dialog.querySelector('[data-pen-check=copy]')!.addEventListener('click', () => run(async () => {
    await navigator.clipboard.writeText(JSON.stringify({ app: `Notelin ${version}`, browser: navigator.userAgent, penSeen, buttonSeen, nativeButtonSeen, primaryHoverSeen, checked, events }, null, 2));
    toast('진단 결과를 복사했어요. 대화에 붙여넣어 주세요.');
  }));
}
