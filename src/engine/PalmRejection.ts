import { penContact } from './pen-input';

type Contact = Pick<PointerEvent, 'pointerType' | 'pointerId' | 'type' | 'buttons' | 'pressure' | 'width' | 'height'>;

// Browsers cannot identify a palm directly. Combine the contact area they
// report with stylus proximity, and keep active pen contact protected even if
// the pen pauses long enough for the proximity timer to expire.
export class PalmRejection {
  private lastPen = -Infinity;
  private activePens = new Set<number>();
  constructor(private now = () => performance.now()) {}

  resetActive() { this.activePens.clear(); }
  endPen(pointerId: number) { this.activePens.delete(pointerId); }

  notePen(event: Contact) {
    if (event.pointerType !== 'pen') return;
    this.lastPen = this.now();
    if (event.type === 'pointerup' || event.type === 'pointercancel' ||
      event.type === 'pointerleave' && !penContact(event)) this.activePens.delete(event.pointerId);
    else if (penContact(event)) this.activePens.add(event.pointerId);
    else this.activePens.delete(event.pointerId);
  }

  rejectTouch(event: Pick<PointerEvent, 'pointerType' | 'width' | 'height'>) {
    if (event.pointerType !== 'touch') return false;
    const width = Math.max(1, event.width || 1), height = Math.max(1, event.height || 1);
    return this.activePens.size > 0 || this.now() - this.lastPen < 800 ||
      width >= 30 || height >= 30 || width * height >= 600;
  }
}
