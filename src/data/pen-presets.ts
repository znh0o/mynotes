import { uid } from './model';
import type { BrushProfile } from './brush-settings';

export const penKinds = ['pen', 'fountain', 'pencil'] as const;
export type PenKind = typeof penKinds[number];
export const penNames: Record<PenKind, string> = { pen: '볼펜', fountain: '만년필', pencil: '연필' };
export const isPenKind = (value: unknown): value is PenKind => penKinds.some(kind => kind === value);

export interface PenPreset {
  id: string; name: string; tool: PenKind; color: string; width: number;
  pencilDarkness: number; pencilAdjustment: 'width' | 'darkness';
}
export interface PenCollection { selectedId: string; presets: PenPreset[] }

export function defaultPenCollection(legacy: Record<PenKind, BrushProfile>): PenCollection {
  const presets = penKinds.map((tool, index) => ({
    id: `starter-${index}`, name: penNames[tool], tool, color: legacy[tool].color,
    width: legacy[tool].width, pencilDarkness: legacy[tool].pencilDarkness ?? .7,
    pencilAdjustment: legacy[tool].pencilAdjustment ?? 'width' as const,
  }));
  return { selectedId: presets[0].id, presets };
}

export function penCollection(value: unknown, fallback: PenCollection): PenCollection {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.presets)) return fallback;
  const ids = new Set<string>();
  const presets: PenPreset[] = [];
  for (const row of raw.presets) {
    if (!row || typeof row !== 'object') continue;
    const pen = row as Record<string, unknown>;
    if (!isPenKind(pen.tool) || typeof pen.id !== 'string' || !pen.id || ids.has(pen.id)) continue;
    ids.add(pen.id);
    presets.push({
      id: pen.id,
      name: typeof pen.name === 'string' && pen.name.trim() ? pen.name.trim().slice(0, 24) : penNames[pen.tool],
      tool: pen.tool,
      color: typeof pen.color === 'string' && /^#[0-9a-f]{6}$/i.test(pen.color) ? pen.color : '#30445e',
      width: typeof pen.width === 'number' && pen.width >= .5 && pen.width <= 20 ? Math.round(pen.width * 2) / 2 : 3,
      pencilDarkness: typeof pen.pencilDarkness === 'number' && pen.pencilDarkness >= .1 && pen.pencilDarkness <= 1 ? pen.pencilDarkness : .7,
      pencilAdjustment: pen.pencilAdjustment === 'darkness' ? 'darkness' : 'width',
    });
  }
  if (!presets.length) return fallback;
  return { presets, selectedId: presets.some(pen => pen.id === raw.selectedId) ? raw.selectedId as string : presets[0].id };
}

export function duplicatePen(preset: PenPreset, count: number): PenPreset {
  return { ...preset, id: uid(), name: `${penNames[preset.tool]} ${count}` };
}
