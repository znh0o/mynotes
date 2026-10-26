// A dedicated handle leaves scrolling and the two-tap opening gesture intact.
export function bindBookReordering(root: HTMLElement, signal: AbortSignal,
  move: (id: string, target: string, before: boolean) => void) {
  type Drag = { id: string; pointer: number; handle: HTMLElement; slot: HTMLElement; x: number; y: number; startX: number; startY: number; moved: boolean; ghost?: HTMLElement; target?: string; before: boolean };
  let drag: Drag | undefined, frame = 0, suppressUntil = 0;
  const slots = () => [...root.querySelectorAll<HTMLElement>('.book-slot')];
  const clearMarkers = () => root.querySelectorAll('.book-drop-before,.book-drop-after').forEach(book => book.classList.remove('book-drop-before', 'book-drop-after'));
  const locate = () => {
    if (!drag?.moved) return;
    clearMarkers();
    let closest: HTMLElement | undefined, distance = Infinity;
    for (const slot of slots()) {
      const rect = slot.getBoundingClientRect();
      const dx = Math.max(rect.left - drag.x, 0, drag.x - rect.right);
      const dy = Math.max(rect.top - drag.y, 0, drag.y - rect.bottom);
      const score = dx * dx + dy * dy * 4;
      if (score < distance) { closest = slot; distance = score; }
    }
    if (!closest) { drag.target = undefined; return; }
    const rect = closest.getBoundingClientRect();
    drag.target = closest.dataset.bookId;
    drag.before = drag.x < rect.left + rect.width / 2;
    if (drag.target !== drag.id) closest.classList.add(drag.before ? 'book-drop-before' : 'book-drop-after');
  };
  const tick = () => {
    if (!drag?.moved) return;
    const dy = drag.y < 100 ? -Math.min(13, (100 - drag.y) / 5) : drag.y > innerHeight - 80 ? Math.min(13, (drag.y - innerHeight + 80) / 5) : 0;
    if (dy) { window.scrollBy(0, dy); locate(); }
    frame = requestAnimationFrame(tick);
  };
  const finish = (commit: boolean) => {
    if (!drag) return;
    const current = drag; drag = undefined;
    cancelAnimationFrame(frame); clearMarkers(); current.ghost?.remove(); current.slot.classList.remove('book-drag-source');
    if (current.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer);
    if (current.moved) suppressUntil = performance.now() + 450;
    if (commit && current.moved && current.target && current.target !== current.id) move(current.id, current.target, current.before);
  };
  root.addEventListener('pointerdown', event => {
    suppressUntil = 0;
    const handle = (event.target as Element).closest<HTMLElement>('.book-move');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    finish(false);
    drag = { id: handle.dataset.id!, pointer: event.pointerId, handle, slot: handle.closest<HTMLElement>('.book-slot')!, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, before: false };
    handle.setPointerCapture(event.pointerId);
  }, { signal });
  root.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.moved && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    event.preventDefault();
    if (!drag.moved) {
      drag.moved = true;
      const source = drag.slot.querySelector<HTMLElement>('.book-spine')!;
      const rect = source.getBoundingClientRect();
      const ghost = document.createElement('div'); ghost.className = 'book-drag-ghost'; ghost.inert = true;
      ghost.setAttribute('style', drag.slot.getAttribute('style') || '');
      ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`;
      ghost.append(source.cloneNode(true)); document.body.append(ghost); drag.ghost = ghost;
      drag.slot.classList.add('book-drag-source'); frame = requestAnimationFrame(tick);
    }
    drag.ghost!.style.transform = `translate3d(${drag.x - drag.ghost!.offsetWidth / 2}px,${drag.y - drag.ghost!.offsetHeight + 14}px,0) rotate(-3deg)`;
    locate();
  }, { signal });
  root.addEventListener('pointerup', event => { if (event.pointerId === drag?.pointer) finish(true); }, { signal });
  root.addEventListener('pointercancel', event => { if (event.pointerId === drag?.pointer) finish(false); }, { signal });
  root.addEventListener('lostpointercapture', event => { if (event.pointerId === drag?.pointer) finish(false); }, { signal });
  root.addEventListener('click', event => {
    if (drag?.moved || performance.now() < suppressUntil && (event.target as Element).closest('.book-slot')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { signal, capture: true });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finish(false); return; }
    const handle = (event.target as Element).closest<HTMLElement>('.book-move');
    if (!handle || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const books = slots(), index = books.findIndex(book => book.dataset.bookId === handle.dataset.id);
    const before = ['ArrowLeft', 'ArrowUp', 'Home'].includes(event.key);
    const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? books.length - 1 : index + (before ? -1 : 1);
    if (books[targetIndex] && targetIndex !== index) move(handle.dataset.id!, books[targetIndex].dataset.bookId!, before);
  }, { signal });
  signal.addEventListener('abort', () => finish(false), { once: true });
  window.addEventListener('resize', () => finish(false), { signal });
}
