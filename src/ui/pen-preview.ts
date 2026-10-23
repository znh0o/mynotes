import type { PenPreset } from '../data/pen-presets';
import { safeColor } from './common';

// High-resolution pen assets are based on the supplied reference layout.
// CSS tints only the grip (or the graphite tip), keeping the body and shading.
export function penPreview(preset: PenPreset, className = '') {
  const ink = safeColor(preset.color);
  return `<span class="pen-preview ${className} pen-preview-${preset.tool}" style="--ink:${ink}" aria-hidden="true"><span class="pen-photo"></span><svg class="pen-ink-sample" viewBox="0 0 94 18" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 14 C26 5 32 6 39 11 S51 16 58 10 S67 7 75 9" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/></svg></span>`;
}
