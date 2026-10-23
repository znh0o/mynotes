// Barrel and inverted-tip eraser are different bits. Android can report the
// barrel alone (2) or together with tip contact (3).
export function penEraser(event: Pick<PointerEvent, 'pointerType' | 'buttons'>) {
  return event.pointerType === 'pen' && (event.buttons & 34) !== 0;
}

export function penContact(event: Pick<PointerEvent, 'buttons' | 'pressure'>) {
  // Samsung Internet can send primary-button moves while the pen pressure is
  // zero. Button bits alone must not start ink or erase while hovering.
  // Pens without pressure hardware report .5 during contact per Pointer Events.
  return (event.buttons & 35) !== 0 && event.pressure > 0;
}

type ButtonSample = Pick<PointerEvent, 'type' | 'pointerType' | 'pointerId' | 'button' | 'buttons' | 'pressure'>;

export function primaryHoverPress(event: Omit<ButtonSample, 'pointerId'>) {
  // The S10+/Samsung Internet report uses a chorded primary-button move,
  // rather than the standard barrel bit. Never treat a normal tip down as it.
  return event.pointerType === 'pen' && event.type === 'pointermove' && event.button === 0
    && event.buttons === 1 && event.pressure === 0;
}

export class SamsungPenToggle {
  private held: number | null = null;
  reset() { this.held = null; }
  update(event: ButtonSample, enabled: boolean, contactActive: boolean) {
    if (!enabled) { this.reset(); return false; }
    if (event.pointerType !== 'pen') return false;
    if (event.buttons === 0 || ['pointerup', 'pointercancel', 'pointerleave'].includes(event.type)) {
      if (this.held === event.pointerId) this.reset();
      return false;
    }
    if (contactActive || this.held !== null || !primaryHoverPress(event)) return false;
    this.held = event.pointerId;
    return true;
  }
}
