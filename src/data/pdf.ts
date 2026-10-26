import { db, persistNew, download } from './store';
import { uid, type Note, type Page, type Asset } from './model';
import { drawItems, drawPaper, imageCache } from '../engine/render';
import type { PDFDocumentProxy } from 'pdfjs-dist';

let pdfModule: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined;
const documents = new Map<string, PDFDocumentProxy>();
const pdfOptions = { cMapUrl: `${import.meta.env.BASE_URL}pdf/cmaps/`, cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdf/standard_fonts/`, wasmUrl: `${import.meta.env.BASE_URL}pdf/wasm/` };
async function pdfjs() {
  // Both realms need PDF.js's maintained compatibility shims (Samsung Internet
  // may not provide Map/WeakMap.getOrInsertComputed yet).
  if (!pdfModule) pdfModule = import('pdfjs-dist/legacy/build/pdf.mjs').then(async lib => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  }).catch(error => { pdfModule = undefined; throw error; });
  return pdfModule;
}
async function documentFor(id: string) {
  let doc = documents.get(id);
  if (!doc) {
    const asset = await db.assets.get(id); if (!asset) throw new Error('PDF 원본을 찾을 수 없어요.');
    const lib = await pdfjs();
    const task = lib.getDocument({ ...pdfOptions, data: new Uint8Array(await asset.blob.arrayBuffer()) });
    try { doc = await task.promise; } catch (error) { await task.destroy(); throw error; }
    documents.set(id, doc);
    if (documents.size > 2) { const key = documents.keys().next().value!; const old = documents.get(key); documents.delete(key); await old?.loadingTask.destroy(); }
  }
  return doc;
}
export async function importPDF(file: File, folderId: string | null, temporary = false): Promise<Note> {
  if (file.size > 150 * 1024 * 1024) throw new Error('PDF는 150MB 이하로 가져올 수 있어요.');
  const lib = await pdfjs(), task = lib.getDocument({ ...pdfOptions, data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const id = uid(), assetId = uid(), pages: Page[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i), v = p.getViewport({ scale: 1 });
      pages.push({ id: uid(), noteId: id, width: v.width, height: v.height, paper: 'blank', paperColor: '#ffffff', spacing: 32, items: [], revision: 0, pdfAssetId: assetId, pdfIndex: i });
      p.cleanup();
    }
    const now = Date.now(), note: Note = { id, title: file.name.replace(/\.pdf$/i, ''), cover: '#d9bfd1', folderId, pageIds: pages.map(p => p.id), created: now, updated: now, opened: now, favorite: false, deleted: null, ...(temporary ? { temporary: true } : {}) };
    const asset: Asset = { id: assetId, noteId: id, blob: new Blob([await file.arrayBuffer()], { type: 'application/pdf' }), name: file.name };
    await persistNew(note, pages, [asset]); return note;
  } finally { await task.destroy(); }
}
export async function loadImages(page: Page) {
  for (const item of page.items) {
    if (item.kind !== 'image' || imageCache.has(item.assetId)) continue;
    const asset = await db.assets.get(item.assetId); if (!asset) throw new Error('이미지 파일이 누락되었어요.');
    const url = URL.createObjectURL(asset.blob), img = new Image();
    try { img.src = url; await img.decode(); imageCache.set(item.assetId, img); }
    finally { URL.revokeObjectURL(url); }
  }
  const needed = new Set(page.items.filter(i => i.kind === 'image').map(i => i.assetId));
  if (imageCache.size > 30) for (const key of imageCache.keys()) if (!needed.has(key)) imageCache.delete(key);
}
export async function background(canvas: HTMLCanvasElement, page: Page, scale: number,
  crop?: { x: number; y: number; w: number; h: number }) {
  const ctx = canvas.getContext('2d')!;
  canvas.width = Math.ceil((crop?.w ?? page.width) * scale);
  canvas.height = Math.ceil((crop?.h ?? page.height) * scale);
  if (page.pdfAssetId && page.pdfIndex) {
    const doc = await documentFor(page.pdfAssetId), pdfPage = await doc.getPage(page.pdfIndex);
    await pdfPage.render({ canvas, viewport: pdfPage.getViewport({ scale,
      offsetX: -(crop?.x ?? 0) * scale, offsetY: -(crop?.y ?? 0) * scale }),
      background: crop ? page.paperColor : undefined }).promise;
    pdfPage.cleanup();
  } else {
    ctx.setTransform(scale, 0, 0, scale, -(crop?.x ?? 0) * scale, -(crop?.y ?? 0) * scale);
    drawPaper(ctx, page);
  }
}
export async function thumbnail(page: Page) {
  await loadImages(page);
  const canvas = document.createElement('canvas'), scale = 250 / page.width;
  await background(canvas, page, scale);
  const ctx = canvas.getContext('2d')!; ctx.setTransform(scale, 0, 0, scale, 0, 0); drawItems(ctx, page.items);
  return canvas.toDataURL('image/webp', .7);
}
export async function exportPDF(note: Note, progress: (n: number, total: number) => void) {
  const { renderPDF } = await import('./pdf-export');
  const bytes = await renderPDF(note, id => db.pages.get(id), id => db.assets.get(id), progress);
  return download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${note.title.replace(/[<>:"/\\|?*]/g, '_')}.pdf`);
}
