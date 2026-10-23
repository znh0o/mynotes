import type { PenPreset } from '../data/pen-presets';
import { safeColor } from './common';

// High-resolution pen assets are based on the supplied reference layout.
// Recolor the pencil's graphite pixels directly so its grain survives.
export function penPreview(preset: PenPreset, className = '') {
  const ink = safeColor(preset.color);
  const pencil = preset.tool === 'pencil' ? `<canvas class="pen-pencil-raster" data-color="${ink}" width="600" height="200"></canvas>` : '';
  return `<span class="pen-preview ${className} pen-preview-${preset.tool}" style="--ink:${ink}" aria-hidden="true"><span class="pen-photo">${pencil}</span><svg class="pen-ink-sample" viewBox="0 0 94 18" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 14 C26 5 32 6 39 11 S51 16 58 10 S67 7 75 9" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/></svg></span>`;
}

let pencilSource: Promise<HTMLImageElement> | undefined;
const pencilColors = new Map<string, HTMLCanvasElement>();

function loadPencil() {
  return pencilSource ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = new URL('../assets/pen-pencil.png', import.meta.url).href;
  });
}

function coloredPencil(source: HTMLImageElement, color: string) {
  const cached = pencilColors.get(color);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 200;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 63; x < 146; x++) {
      const index = (y * canvas.width + x) * 4;
      const [r, g, b, alpha] = image.data.subarray(index, index + 4);
      if (alpha < 8) continue;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const luminance = .2126 * r + .7152 * g + .0722 * b;
      const strength = Math.min(1, Math.max(0, (60 - chroma) / 25)) * Math.min(1, Math.max(0, (190 - luminance) / 55));
      if (!strength) continue;
      // Keep the source graphite's light and dark strokes: only change hue.
      const peak = Math.max(red, green, blue);
      const coloredLight = Math.min(210, luminance * 1.22 + 22);
      const tone = peak < 32
        ? [luminance, luminance, luminance]
        : [red, green, blue].map(channel => coloredLight * (.24 + .93 * channel / peak));
      image.data[index] = r * (1 - strength) + tone[0] * strength;
      image.data[index + 1] = g * (1 - strength) + tone[1] * strength;
      image.data[index + 2] = b * (1 - strength) + tone[2] * strength;
    }
  }
  context.putImageData(image, 0, 0);
  if (pencilColors.size >= 24) pencilColors.clear();
  pencilColors.set(color, canvas);
  return canvas;
}

export function paintPencilPreviews(root: ParentNode) {
  const targets = Array.from(root.querySelectorAll<HTMLCanvasElement>('.pen-pencil-raster'));
  if (!targets.length) return;
  void loadPencil().then(source => {
    for (const target of targets) {
      const color = safeColor(target.dataset.color || '');
      target.getContext('2d')?.drawImage(coloredPencil(source, color), 0, 0);
      target.dataset.ready = 'true';
    }
  }).catch(() => { /* The original photo remains visible if the asset fails to load. */ });
}
