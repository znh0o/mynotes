// Barrel and inverted-tip eraser are different bits. Android can report the
// barrel alone (2) or together with tip contact (3).
export function penEraser(event: Pick<PointerEvent, 'pointerType' | 'buttons'>) {
  return event.pointerType === 'pen' && (event.buttons & 34) !== 0;
}

export function penContact(event: Pick<PointerEvent, 'buttons' | 'pressure'>) {
  return (event.buttons & 1) !== 0 || (event.buttons & 34) !== 0 && event.pressure > 0;
}
