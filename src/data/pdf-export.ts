import { PDFDocument, type PDFPage, type PDFFont, rgb, degrees, LineCapStyle, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, StandardFonts } from 'pdf-lib';
import { smooth, drawItem } from '../engine/render';
import type { Asset, Item, Note, Page, Point, Stroke } from './model';

const color = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const n = (value: number) => String(Math.round(value * 1000) / 1000);
const path = (points: {x: number; y: number}[], close = false) => points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join(' ') + (close ? ' Z' : '');
const radius = (stroke: Stroke, point: Point) => stroke.width * (.22 + .78 * Math.pow(Math.max(.05, point.p), .65)) / 2;

function ink(out: PDFPage, stroke: Stroke, height: number) {
  const points = smooth(stroke.points); if (!points.length) return;
  const c = color(stroke.color), first = points[0], last = points[points.length - 1];
  if (stroke.tool === 'highlighter' || !stroke.pressure) {
    const opacity = stroke.tool === 'highlighter' ? .32 : 1;
    if (points.length === 1) out.drawCircle({ x: first.x, y: height - first.y, size: stroke.width / 2, color: c, opacity });
    else out.drawSvgPath(path(points), { x: 0, y: height, borderColor: c, borderWidth: stroke.width, borderLineCap: LineCapStyle.Round, borderOpacity: opacity });
    return;
  }
  const left: {x: number; y: number}[] = [], right: {x: number; y: number}[] = [];
  points.forEach((point, i) => {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x) + Math.PI / 2, r = radius(stroke, point);
    left.push({ x: point.x + Math.cos(angle) * r, y: point.y + Math.sin(angle) * r });
    right.push({ x: point.x - Math.cos(angle) * r, y: point.y - Math.sin(angle) * r });
  });
  out.drawSvgPath(path([...left, ...right.reverse()], true), { x: 0, y: height, color: c });
  for (const p of [first, last]) out.drawCircle({ x: p.x, y: height - p.y, size: radius(stroke, p), color: c });
}

function paper(out: PDFPage, page: Page, font: PDFFont) {
  const w = page.width, h = page.height, s = page.spacing;
  out.drawRectangle({ x: 0, y: 0, width: w, height: h, color: color(page.paperColor) });
  const line = (x1: number, y1: number, x2: number, y2: number) => out.drawLine({ start: { x: x1, y: h - y1 }, end: { x: x2, y: h - y2 }, thickness: .8, color: color('#bdc9d6'), opacity: .3 });
  if (page.paper === 'lined' || page.paper === 'cornell') for (let y = 96; y < h - 55; y += s) line(48, y, w - 48, y);
  if (page.paper === 'grid') {
    for (let x = 32; x < w - 20; x += s) line(x, 32, x, h - 32);
    for (let y = 32; y < h - 20; y += s) line(32, y, w - 32, y);
  }
  if (page.paper === 'dots') for (let y = 40; y < h - 20; y += s) for (let x = 40; x < w - 20; x += s) out.drawCircle({ x, y: h - y, size: 1, color: color('#b3bfce'), opacity: .6 });
  if (page.paper === 'cornell') { line(w * .27, 64, w * .27, h - 200); line(48, h - 200, w - 48, h - 200); }
  if (page.paper === 'planner') {
    out.drawText('W E E K L Y   P L A N', { x: 48, y: h - 65, font, size: 20, color: color('#8396ab') });
    ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach((day, i) => {
      const y = 108 + (h - 156) / 7 * i; line(48, y, w - 48, y); line(112, y, 112, y + (h - 156) / 7);
      out.drawText(day, { x: 50, y: h - y - 26, size: 12, font, color: color('#8396ab') });
    });
  }
}

async function originalPage(output: PDFDocument, original: PDFDocument, page: Page): Promise<PDFPage> {
  const source = original.getPage(page.pdfIndex! - 1), rotation = ((source.getRotation().angle % 360) + 360) % 360;
  const crop = source.getCropBox(), media = source.getMediaBox();
  if (rotation === 0 && crop.x === 0 && crop.y === 0 && crop.width === media.width && crop.height === media.height) { const [copied] = await output.copyPages(original, [page.pdfIndex! - 1]); return output.addPage(copied); }
  // Embed the original PDF graphics as a vector Form XObject, normalizing rotation.
  if (!source.node.Contents()) return output.addPage([page.width, page.height]);
  const embedded = await output.embedPage(source, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height });
  const out = output.addPage([page.width, page.height]);
  if (rotation === 0) out.drawPage(embedded, { x: 0, y: 0, width: page.width, height: page.height });
  else if (rotation === 90) out.drawPage(embedded, { x: 0, y: page.height, width: page.height, height: page.width, rotate: degrees(-90) });
  else if (rotation === 180) out.drawPage(embedded, { x: page.width, y: page.height, width: page.width, height: page.height, rotate: degrees(180) });
  else out.drawPage(embedded, { x: page.width, y: 0, width: page.height, height: page.width, rotate: degrees(90) });
  return out;
}

async function drawObject(output: PDFDocument, out: PDFPage, item: Item, page: Page, loadAsset: (id: string) => Promise<Asset | undefined>) {
  if (item.kind === 'stroke') return ink(out, item, page.height);
  if (item.kind === 'shape') {
    const { x, y, w, h } = item;
    if (item.shape === 'ellipse') {
      out.drawEllipse({ x: x + w / 2, y: page.height - y - h / 2, xScale: Math.abs(w / 2), yScale: Math.abs(h / 2), borderColor: color(item.color), borderWidth: item.width });
    } else {
      const points = item.shape === 'line' ? [{ x, y }, { x: x + w, y: y + h }] : item.shape === 'triangle' ? [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }] : [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
      out.drawSvgPath(path(points, item.shape !== 'line'), { x: 0, y: page.height, borderColor: color(item.color), borderWidth: item.width, borderLineCap: LineCapStyle.Round });
    }
    return;
  }
  if (item.kind === 'image') {
    const asset = await loadAsset(item.assetId); if (!asset) throw new Error('이미지 원본을 찾을 수 없어요.');
    const bytes = await asset.blob.arrayBuffer(); let image;
    if (asset.blob.type === 'image/png') image = await output.embedPng(bytes);
    else if (asset.blob.type === 'image/jpeg') image = await output.embedJpg(bytes);
    else {
      const bitmap = await createImageBitmap(asset.blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close(); image = await output.embedPng(canvas.toDataURL('image/png')); canvas.width = canvas.height = 0;
    }
    out.drawImage(image, { x: item.x, y: page.height - item.y - item.h, width: item.w, height: item.h }); return;
  }
  // Unicode text keeps the browser's font appearance. Rasterize only this tight
  // text box at 4x, rather than flattening the complete page and all pen paths.
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  ctx.font = `400 ${item.size}px "Segoe UI", "Malgun Gothic", sans-serif`;
  const w = Math.max(1, ...item.text.split('\n').map(line => ctx.measureText(line).width)) + item.size * .4;
  const h = Math.max(item.size * 1.7, item.text.split('\n').length * item.size * 1.55);
  const scale = Math.min(4, 8192 / Math.max(w, h), Math.sqrt(16000000 / (w * h)));
  canvas.width = Math.ceil(w * scale); canvas.height = Math.ceil(h * scale); ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawItem(ctx, { ...item, x: 0, y: 0 });
  const image = await output.embedPng(canvas.toDataURL('image/png'));
  out.drawImage(image, { x: item.x, y: page.height - item.y - h, width: w, height: h }); canvas.width = canvas.height = 0;
}

export async function renderPDF(note: Note, loadPage: (id: string) => Promise<Page | undefined>, loadAsset: (id: string) => Promise<Asset | undefined>, progress: (n: number, total: number) => void) {
  const output = await PDFDocument.create(), font = await output.embedFont(StandardFonts.Helvetica);
  const originals = new Map<string, PDFDocument>();
  for (let index = 0; index < note.pageIds.length; index++) {
    const page = await loadPage(note.pageIds[index]); if (!page) throw new Error('페이지가 누락되었어요.');
    let out: PDFPage;
    if (page.pdfAssetId && page.pdfIndex) {
      let original = originals.get(page.pdfAssetId);
      if (!original) { const asset = await loadAsset(page.pdfAssetId); if (!asset) throw new Error('PDF 원본 누락'); original = await PDFDocument.load(await asset.blob.arrayBuffer()); originals.set(page.pdfAssetId, original); }
      out = await originalPage(output, original, page);
    } else { out = output.addPage([page.width, page.height]); paper(out, page, font); }
    out.pushOperators(pushGraphicsState(), rectangle(0, 0, page.width, page.height), clip(), endPath());
    for (const item of page.items) await drawObject(output, out, item, page, loadAsset);
    out.pushOperators(popGraphicsState()); progress(index + 1, note.pageIds.length);
  }
  return output.save();
}
