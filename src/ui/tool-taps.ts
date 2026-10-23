// Tablet browsers can delay or omit the compatibility click after stylus use.
// Activate completed pen/touch taps directly, while preserving horizontal drags
// and suppressing the later click so undo, toggles, etc. only execute once.
export function bindToolTaps(root: HTMLElement, activate: (event: PointerEvent) => void, signal: AbortSignal) {
  const selector = 'button[data-action]';
  let tap: { pointer: number; button: HTMLButtonElement; x: number; y: number } | null = null;
  let consumed: { button: HTMLButtonElement; time: number }[] = [];
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
    event.preventDefault();
    const now = performance.now(); consumed = consumed.filter(tap => now - tap.time < 700);
    consumed.push({ button: target, time: now }); activate(event);
  }, { signal });
  root.addEventListener('click', event => {
    if (event.detail === 0) return;
    const now = performance.now(); consumed = consumed.filter(tap => now - tap.time < 700);
    const button = (event.target as Element).closest(selector), index = consumed.findIndex(tap => tap.button === button);
    if (index !== -1) {
      event.preventDefault(); event.stopImmediatePropagation(); consumed.splice(index, 1);
    }
  }, { signal, capture: true });
}
