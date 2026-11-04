export interface ExamPreset { id: string; name: string; seconds: number }

export function examPresets(value: unknown): ExamPreset[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ExamPreset => !!item && typeof item.id === 'string' && item.id.length < 100
    && typeof item.name === 'string' && item.name.trim().length > 0 && Number.isInteger(item.seconds)
    && item.seconds >= 60 && item.seconds <= 24 * 3600)
    .slice(0, 30).map(item => ({ id: item.id, name: item.name.trim().slice(0, 40), seconds: item.seconds }));
}
