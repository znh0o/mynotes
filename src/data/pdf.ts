import { db, persistNew, download } from './store';
import { uid, type Note, type Page, type Asset } from './model';
import { drawItems, drawPaper, imageCache } from '../engine/render';
import type { PDFDocumentProxy } from 'pdfjs-dist';

let pdfModule: Promise<typeof import('pdfjs-dist')> | undefined;
const documents = new Map<string, PDFDocumentProxy>();
const pdfOptions = { cMapUrl: `${import.meta.env.BASE_URL}pdf/cmaps/`, cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdf/standard_fonts/`, wasmUrl: `${import.meta.env.BASE_URL}pdf/wasm/` };
async function pdfjs() {
  if (!pdfModule) pdfModule = import('pdfjs-dist').then(async lib => {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfModule;
}
async function documentFor(id: string) {
  let doc = documents.get(id);
  if (!doc) {
    const asset = await db.assets.get(id); if (!asset) throw new Error('PDF 원본을 찾을 수 없어요.');
    const lib = await pdfjs();
    doc = await lib.getDocument({ ...pdfOptions, data: new Uint8Array(await asset.blob.arrayBuffer()) }).promise;
    documents.set(id, doc);
    if (documents.size > 2) { const key = documents.keys().next().value!; const old = documents.get(key); documents.delete(key); await old?.loadingTask.destroy(); }
  }
  return doc;
}
export async function importPDF(file: File, folderId: string | null): Promise<Note> {
  if (file.size > 150 * 1024 * 1024) throw new Error('PDF는 150MB 이하로 가져올 수 있어요.');
  const lib = await pdfjs(), task = lib.getDocument({ ...pdfOptions, data: new Uint8Array(await file.arrayBuffer()) }), doc = await task.promise;
  try {
    const id = uid(), assetId = uid(), pages: Page[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i), v = p.getViewport({ scale: 1 });
      pages.push({ id: uid(), noteId: id, width: v.width, height: v.height, paper: 'blank', paperColor: '#ffffff', spacing: 32, items: [], revision: 0, pdfAssetId: assetId, pdfIndex: i });
      p.cleanup();
    }
    const now = Date.now(), note: Note = { id, title: file.name.replace(/\.pdf$/i, ''), cover: '#d9bfd1', folderId, pageIds: pages.map(p => p.id), created: now, updated: now, opened: now, favorite: false, deleted: null };
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
export async function background(canvas: HTMLCanvasElement, page: Page, scale: number) {
  const ctx = canvas.getContext('2d')!;
  canvas.width = Math.ceil(page.width * scale); canvas.height = Math.ceil(page.height * scale);
  if (page.pdfAssetId && page.pdfIndex) {
    const doc = await documentFor(page.pdfAssetId), pdfPage = await doc.getPage(page.pdfIndex);
    await pdfPage.render({ canvas, viewport: pdfPage.getViewport({ scale }) }).promise;
    pdfPage.cleanup();
  } else { ctx.setTransform(scale, 0, 0, scale, 0, 0); drawPaper(ctx, page); }
}
export async function thumbnail(page: Page) {
  await loadImages(page);
  const canvas = document.createElement('canvas'), scale = 250 / page.width;
  await background(canvas, page, scale);
  const ctx = canvas.getContext('2d')!; ctx.setTransform(scale, 0, 0, scale, 0, 0); drawItems(ctx, page.items);
  return canvas.toDataURL('image/webp', .7);
}
export async function exportPDF(note: Note, progress: (n: number, total: number) => void) {
  const { PDFDocument } = await import('pdf-lib'), output = await PDFDocument.create();
  const originals = new Map<string, Awaited<ReturnType<typeof PDFDocument.load>>>();
  for (let index = 0; index < note.pageIds.length; index++) {
    const page = await db.pages.get(note.pageIds[index]); if (!page) throw new Error('페이지가 누락되었어요.');
    await loadImages(page);
    const canvas = document.createElement('canvas'), scale = Math.min(2, 2400 / Math.max(page.width, page.height));
    let outPage;
    if (page.pdfAssetId && page.pdfIndex) {
      let original = originals.get(page.pdfAssetId);
      if (!original) { const a = await db.assets.get(page.pdfAssetId); if (!a) throw new Error('PDF 원본 누락'); original = await PDFDocument.load(await a.blob.arrayBuffer()); originals.set(page.pdfAssetId, original); }
      const source = original.getPage(page.pdfIndex - 1);
      if (source.getRotation().angle === 0) { const [copied] = await output.copyPages(original, [page.pdfIndex - 1]); outPage = output.addPage(copied); canvas.width = Math.ceil(page.width * scale); canvas.height = Math.ceil(page.height * scale); }
      else { outPage = output.addPage([page.width, page.height]); await background(canvas, page, scale); }
    } else { outPage = output.addPage([page.width, page.height]); await background(canvas, page, scale); }
    const ctx = canvas.getContext('2d')!; ctx.setTransform(scale, 0, 0, scale, 0, 0); drawItems(ctx, page.items);
    const overlay = await output.embedPng(canvas.toDataURL('image/png'));
    outPage.drawImage(overlay, { x: 0, y: 0, width: page.width, height: page.height });
    canvas.width = 0; canvas.height = 0; progress(index + 1, note.pageIds.length);
  }
  const bytes = await output.save();
  download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${note.title.replace(/[<>:"/\\|?*]/g, '_')}.pdf`);
}
