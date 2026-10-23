import { escape, icon, report, safeColor } from './common';

type Hsv = { h: number; s: number; v: number };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function toHsv(hex: string): Hsv {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rgb[0]) h = ((rgb[1] - rgb[2]) / delta) % 6;
    else if (max === rgb[1]) h = (rgb[2] - rgb[0]) / delta + 2;
    else h = (rgb[0] - rgb[1]) / delta + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

function toHex({ h, s, v }: Hsv) {
  const chroma = v * s, segment = h / 60, x = chroma * (1 - Math.abs(segment % 2 - 1));
  const colors = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x]
    : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${colors.map(value => Math.round((value + v - chroma) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function openColorPicker(current: string, palette: string[] | undefined,
  apply: (color: string, palette?: string[]) => Promise<void> | void, anchor: HTMLElement) {
  const colors = palette?.map(safeColor), selected = colors ? Math.max(0, colors.indexOf(current)) : 0;
  let slot = selected, hsv = toHsv(colors?.[slot] || safeColor(current));
  document.querySelector<HTMLElement>('.color-picker-dialog:popover-open')?.hidePopover();
  const panel = document.createElement('div');
  panel.className = 'color-picker-dialog'; panel.popover = 'manual';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', colors ? '기본 색상 편집' : '색상 선택');
  panel.innerHTML = `<form><div class="color-picker-heading"><strong>${colors ? '기본 색상 편집' : '색상 선택'}</strong><button type="button" class="icon-button" data-close aria-label="색상 창 닫기">${icon('X', 17)}</button></div><div class="color-picker-body">
    ${colors ? `<p class="color-picker-help">바꿀 색상 칸을 선택한 뒤 색을 조절해 주세요.</p><div class="color-picker-slots" role="group" aria-label="기본 색상 5개">${colors.map((color, index) => `<button type="button" class="color-picker-slot" data-slot="${index}" aria-label="기본 색상 ${index + 1}" aria-pressed="${index === selected}" style="--slot-color:${color}"><span></span><small>${index + 1}</small></button>`).join('')}</div>` : ''}
    <div class="color-picker-square" tabindex="0" role="slider" aria-label="색의 채도와 밝기" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span class="color-picker-marker"></span></div>
    <label class="color-picker-hue-label">색조<input class="color-picker-hue" type="range" min="0" max="359" step="1" aria-label="색조" /></label>
    <div class="color-picker-bottom"><span class="color-picker-preview" aria-hidden="true"></span><label>HEX<input class="color-picker-hex" aria-label="HEX 색상 코드" inputmode="text" maxlength="7" spellcheck="false" /></label></div>
  </div><div class="color-picker-actions"><button type="button" class="button secondary" data-close>취소</button><button type="submit" class="button primary">${escape(colors ? '색상 저장' : '이 색 사용')}</button></div></form>`;
  const square = panel.querySelector<HTMLElement>('.color-picker-square')!;
  const marker = panel.querySelector<HTMLElement>('.color-picker-marker')!;
  const hue = panel.querySelector<HTMLInputElement>('.color-picker-hue')!;
  const hex = panel.querySelector<HTMLInputElement>('.color-picker-hex')!;
  const preview = panel.querySelector<HTMLElement>('.color-picker-preview')!;
  const sync = (updateHex = true) => {
    const value = toHex(hsv);
    square.style.setProperty('--picker-hue', `hsl(${hsv.h} 100% 50%)`);
    marker.style.left = `${hsv.s * 100}%`; marker.style.top = `${(1 - hsv.v) * 100}%`;
    hue.value = String(Math.round(hsv.h)); preview.style.backgroundColor = value;
    square.setAttribute('aria-valuenow', String(Math.round(hsv.v * 100)));
    square.setAttribute('aria-valuetext', `채도 ${Math.round(hsv.s * 100)}%, 밝기 ${Math.round(hsv.v * 100)}%`);
    if (updateHex) hex.value = value.toUpperCase();
    if (colors) {
      colors[slot] = value;
      panel.querySelectorAll<HTMLElement>('[data-slot]').forEach((button, index) => {
        button.style.setProperty('--slot-color', colors[index]); button.setAttribute('aria-pressed', String(index === slot));
      });
    }
  };
  const pick = (event: PointerEvent) => {
    const rect = square.getBoundingClientRect();
    hsv.s = clamp((event.clientX - rect.left) / rect.width);
    hsv.v = 1 - clamp((event.clientY - rect.top) / rect.height); sync();
  };
  square.addEventListener('pointerdown', event => { event.preventDefault(); square.setPointerCapture(event.pointerId); pick(event); });
  square.addEventListener('pointermove', event => { if (square.hasPointerCapture(event.pointerId)) pick(event); });
  square.addEventListener('pointerup', event => { if (square.hasPointerCapture(event.pointerId)) square.releasePointerCapture(event.pointerId); });
  square.addEventListener('keydown', event => {
    const step = event.shiftKey ? .05 : .01;
    if (event.key === 'ArrowLeft') hsv.s = clamp(hsv.s - step);
    else if (event.key === 'ArrowRight') hsv.s = clamp(hsv.s + step);
    else if (event.key === 'ArrowUp') hsv.v = clamp(hsv.v + step);
    else if (event.key === 'ArrowDown') hsv.v = clamp(hsv.v - step);
    else return;
    event.preventDefault(); sync();
  });
  hue.addEventListener('input', () => { hsv.h = Number(hue.value); sync(); });
  hex.addEventListener('input', () => {
    const value = hex.value.startsWith('#') ? hex.value : `#${hex.value}`;
    if (/^#[0-9a-f]{6}$/i.test(value)) { hsv = toHsv(value); sync(false); }
  });
  hex.addEventListener('blur', () => sync());
  panel.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => button.addEventListener('click', () => {
    slot = Number(button.dataset.slot); hsv = toHsv(colors![slot]); sync();
  }));
  panel.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => panel.hidePopover()));
  panel.querySelector('form')!.addEventListener('submit', async event => {
    event.preventDefault();
    const save = panel.querySelector<HTMLButtonElement>('[type=submit]')!;
    save.disabled = true;
    try { await apply(toHex(hsv), colors); panel.hidePopover(); }
    catch (error) { report(error); }
    finally { save.disabled = false; }
  });
  const dismiss = new AbortController();
  document.addEventListener('pointerdown', event => {
    if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) panel.hidePopover();
  }, { capture: true, signal: dismiss.signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); panel.hidePopover(); }
  }, { capture: true, signal: dismiss.signal });
  panel.addEventListener('toggle', () => {
    const open = panel.matches(':popover-open'); anchor.setAttribute('aria-expanded', String(open));
    if (!open) { dismiss.abort(); panel.remove(); }
  });
  document.body.append(panel);
  panel.showPopover(); anchor.setAttribute('aria-expanded', 'true');
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(rect.bottom + 7, innerHeight - panel.offsetHeight - 8))}px`;
  sync();
  return panel;
}
