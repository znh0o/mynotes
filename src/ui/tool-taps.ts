// Tablet browsers can delay or omit the compatibility click after stylus use.
// Activate completed pen/touch taps directly, while preserving horizontal drags
// and suppressing the later click so undo, toggles, etc. only execute once.
export function bindToolTaps(root: HTMLElement, activate: (event: PointerEvent) => void, signal: AbortSignal) {
  const selector = '.ink-toolbar button[data-action],.tool-options button[data-action]';
  let tap: { pointer: number; button: HTMLButtonElement; x: number; y: number } | null = null;
  let consumed: { button: HTMLButtonElement; time: number } | null = null;
  root.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'pen' && event.pointerType !== 'touch') return;
    const button = (event.target as Element).closest<HTMLButtonElement>(selector);
    if (!button || button.disabled || event.button !== 0) return;
    tap = { pointer: event.pointerId, button, x: event.clientX, y: event.clientY };
  }, { signal });
  root.addEventListener('pointermove', event => {
    if (tap?.pointer === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) tap = null;
  }, { signal });
  root.addEventListener('pointercancel', event => { if (tap?.pointer === event.pointerId) tap = null; }, { signal });
  root.addEventListener('pointerup', event => {
    if (tap?.pointer !== event.pointerId) return;
    const target = (event.target as Element).closest<HTMLButtonElement>(selector), current = tap; tap = null;
    if (target !== current.button || target.disabled || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) return;
    event.preventDefault(); consumed = { button: target, time: performance.now() }; activate(event);
  }, { signal });
  root.addEventListener('click', event => {
    if (event.detail === 0 || !consumed || performance.now() - consumed.time > 700) return;
    if ((event.target as Element).closest(selector) === consumed.button) {
      event.preventDefault(); event.stopImmediatePropagation(); consumed = null;
    }
  }, { signal, capture: true });
}
