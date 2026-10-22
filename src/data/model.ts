export type Paper = 'blank' | 'lined' | 'grid' | 'dots' | 'cornell' | 'planner';
export type Tool = 'pen' | 'fountain' | 'highlighter' | 'eraser' | 'lasso' | 'shape' | 'text' | 'image' | 'hand';
export type Shape = 'line' | 'rect' | 'ellipse' | 'triangle';
export interface Point { x: number; y: number; p: number; t: number }
export interface Stroke {
  id: string; kind: 'stroke'; tool: 'pen' | 'fountain' | 'highlighter';
  color: string; width: number; pressure: boolean; points: Point[];
}
export interface ShapeItem {
  id: string; kind: 'shape'; shape: Shape; x: number; y: number; w: number; h: number;
  color: string; width: number;
}
export interface TextItem {
  id: string; kind: 'text'; x: number; y: number; w: number; h: number;
  text: string; color: string; size: number;
}
export interface ImageItem {
  id: string; kind: 'image'; x: number; y: number; w: number; h: number; assetId: string;
}
export type Item = Stroke | ShapeItem | TextItem | ImageItem;
export interface Page {
  id: string; noteId: string; width: number; height: number; paper: Paper;
  paperColor: string; spacing: number; items: Item[]; revision: number;
  pdfAssetId?: string; pdfIndex?: number; thumbnail?: string;
}
export interface Note {
  id: string; title: string; cover: string; folderId: string | null;
  pageIds: string[]; created: number; updated: number; opened: number;
  favorite: boolean; deleted: number | null; thumbnail?: string;
}
export interface Folder { id: string; name: string; color: string }
export interface Asset { id: string; noteId: string; blob: Blob; name: string }
export const uid = () => crypto.randomUUID();
export const paperNames: Record<Paper, string> = {
  blank: '무지', lined: '줄노트', grid: '모눈', dots: '도트', cornell: '코넬', planner: '주간 플래너'
};
export const covers = ['#5482da', '#50a08c', '#bd73a4', '#c69b63', '#8575ce', '#344e7c'];
export function newPage(noteId: string, options: Partial<Page> = {}): Page {
  return { id: uid(), noteId, width: 794, height: 1123, paper: 'lined',
    paperColor: '#fffefb', spacing: 32, items: [], revision: 0, ...options };
}
export function createNote(title: string, cover: string, folderId: string | null, options: Partial<Page> = {}) {
  const now = Date.now(), id = uid(), page = newPage(id, options);
  const note: Note = { id, title, cover, folderId, pageIds: [page.id], created: now,
    updated: now, opened: now, favorite: false, deleted: null };
  return { note, page };
}
