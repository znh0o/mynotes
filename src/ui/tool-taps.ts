// Normalize completed stylus/touch taps, including dialogs, form submit and
// menus. The native click path keeps every button's actual action intact.
export function installFastTaps(root: Document = document) {
  type Tap = { pointer: number; type: string; button: HTMLButtonElement; x: number; y: number; time: number };
  let tap: Tap | null = null, consumed: Tap[] = [];
  const buttonAt = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
  root.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') { consumed = []; return; }
    if (!['pen', 'touch'].includes(event.pointerType) || event.button !== 0) return;
    const button = buttonAt(event);
    if (!button || button.disabled || button.closest('[inert]')) return;
    // The action may focus a newly opened text field on pointerup. Suppress
    // compatibility mousedown too, or it steals focus back onto this button.
    event.preventDefault();
    tap = { pointer: event.pointerId, type: event.pointerType, button, x: event.clientX, y: event.clientY, time: performance.now() };
  }, { capture: true });
  root.addEventListener('pointermove', event => {
    if (tap?.pointer === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 14) tap = null;
  }, { capture: true });
  root.addEventListener('pointercancel', event => { if (tap?.pointer === event.pointerId) tap = null; }, { capture: true });
  root.addEventListener('pointerup', event => {
    if (tap?.pointer !== event.pointerId) return;
    const current = tap; tap = null;
    if (buttonAt(event) !== current.button || current.button.disabled || !current.button.isConnected || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 14) return;
    event.preventDefault();
    const now = performance.now(); consumed = consumed.filter(tap => now - tap.time < 700);
    consumed.push({ ...current, x: event.clientX, y: event.clientY, time: now });
    current.button.click();
  }, { capture: true });
  root.addEventListener('click', event => {
    const pointerClick = event.clientX !== 0 || event.clientY !== 0 || event instanceof PointerEvent && !!event.pointerType;
    if (event.detail === 0 && !pointerClick) return; // Keyboard, assistive and button.click().
    const now = performance.now(); consumed = consumed.filter(tap => now - tap.time < 700);
    const target = buttonAt(event);
    const index = consumed.findIndex(tap => {
      return target === tap.button || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 20;
    });
    if (index !== -1) {
      event.preventDefault(); event.stopImmediatePropagation(); consumed.splice(index, 1);
    }
  }, { capture: true });
}
