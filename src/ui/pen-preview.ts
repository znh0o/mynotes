import type { PenKind, PenPreset } from '../data/pen-presets';
import { safeColor } from './common';

// Color the material in the original pen photos while preserving highlights and texture.
export function penPreview(preset: Readonly<PenPreset>, className = '') {
  const ink = safeColor(preset.color);
  return `<span class="pen-preview ${className} pen-preview-${preset.tool}" style="--ink:${ink}" aria-hidden="true"><span class="pen-photo"><canvas class="pen-raster" data-tool="${preset.tool}" data-color="${ink}" width="600" height="200"></canvas></span><svg class="pen-ink-sample" viewBox="0 0 94 18" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 14 C26 5 32 6 39 11 S51 16 58 10 S67 7 75 9" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/></svg></span>`;
}

const assetUrls: Record<PenKind, string> = {
  pen: new URL('../assets/pen-ballpoint.png', import.meta.url).href,
  fountain: new URL('../assets/pen-fountain.png', import.meta.url).href,
  pencil: new URL('../assets/pen-pencil.png', import.meta.url).href,
};
const sources = new Map<PenKind, Promise<HTMLImageElement>>();
const coloredPens = new Map<string, HTMLCanvasElement>();

function loadPen(tool: PenKind) {
  let source = sources.get(tool);
  if (!source) {
    source = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = assetUrls[tool];
    });
    sources.set(tool, source);
  }
  return source;
}

function clamp(value: number) { return Math.min(1, Math.max(0, value)); }

function coloredPen(source: HTMLImageElement, tool: PenKind, color: string) {
  const key = `${tool}:${color}`;
  const cached = coloredPens.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 200;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  const bounds = tool === 'pen' ? [175, 405] : tool === 'fountain' ? [230, 370] : [63, 146];
  for (let y = 0; y < canvas.height; y++) {
    for (let x = bounds[0]; x < bounds[1]; x++) {
      const index = (y * canvas.width + x) * 4;
      const [r, g, b, alpha] = image.data.subarray(index, index + 4);
      if (!alpha) continue;
      const luminance = .2126 * r + .7152 * g + .0722 * b;
      let strength: number;
      if (tool === 'pen') {
        // The grip is blue in the source; the silver tip and white body are neutral.
        strength = clamp((b - r - 10) / 25) * clamp((b - g - 8) / 15);
      } else if (tool === 'fountain') {
        // Only the black grip is dark inside this region; the metal rings are lighter.
        strength = clamp((150 - luminance) / 45);
      } else {
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        strength = clamp((60 - chroma) / 25) * clamp((190 - luminance) / 55);
      }
      if (!strength) continue;
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
  if (coloredPens.size >= 36) coloredPens.clear();
  coloredPens.set(key, canvas);
  return canvas;
}

export function paintPenPreviews(root: ParentNode) {
  const targets = Array.from(root.querySelectorAll<HTMLCanvasElement>('.pen-raster'));
  for (const target of targets) {
    const tool = target.dataset.tool as PenKind;
    const color = safeColor(target.dataset.color || '');
    void loadPen(tool).then(source => {
      target.getContext('2d')?.drawImage(coloredPen(source, tool, color), 0, 0);
      target.dataset.ready = 'true';
    }).catch(() => { /* The original photo remains visible if an asset fails to load. */ });
  }
}
