import type { Tool } from './model';

export const inkTools = ['pen', 'fountain', 'pencil', 'highlighter'] as const;
export type InkTool = typeof inkTools[number];
export interface BrushProfile {
  width: number; color: string;
  pencilDarkness?: number; pencilAdjustment?: 'width' | 'darkness';
}
export const isInkTool = (tool: Tool): tool is InkTool => (inkTools as readonly string[]).includes(tool);
export const brushKey = (tool: InkTool) => `brush-profile:${tool}`;
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function brushProfile(tool: InkTool, saved?: unknown, legacyDarkness?: unknown): BrushProfile {
  const value = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  return {
    width: inRange(value.width, .5, 20) ? Math.round(value.width * 2) / 2 : 3,
    color: typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : '#30445e',
    ...(tool === 'pencil' ? {
      pencilDarkness: inRange(value.pencilDarkness, .1, 1) ? value.pencilDarkness : inRange(legacyDarkness, .1, 1) ? legacyDarkness : .7,
      pencilAdjustment: value.pencilAdjustment === 'darkness' ? 'darkness' as const : 'width' as const,
    } : {}),
  };
}
