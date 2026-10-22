import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, degrees, decodePDFRawStream, rgb } from 'pdf-lib';
import { renderPDF } from '../src/data/pdf-export';
import { createNote, type Page, type Asset } from '../src/data/model';

const images = (document: PDFDocument) => document.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
describe('vector PDF export', () => {
  it('writes pressure outlines, highlighter and shapes as PDF paths without bitmap overlays', async () => {
    const { note, page } = createNote('Vector', '#b9cee5', null, { paper: 'grid' });
    page.items = [
      { id: 'ink', kind: 'stroke', tool: 'fountain', width: 4, color: '#30445e', pressure: true, points: [{ x: 40, y: 80, p: .2, t: 0 }, { x: 80, y: 100, p: .9, t: 1 }, { x: 130, y: 80, p: .4, t: 2 }] },
      { id: 'marker', kind: 'stroke', tool: 'highlighter', width: 18, color: '#e5c360', pressure: false, points: [{ x: 40, y: 150, p: .5, t: 0 }, { x: 200, y: 150, p: .5, t: 1 }] },
      { id: 'shape', kind: 'shape', shape: 'ellipse', x: 40, y: 200, w: 180, h: 90, color: '#5e85bd', width: 2 }
    ];
    const bytes = await renderPDF(note, async () => page, async () => undefined, () => {}), document = await PDFDocument.load(bytes);
    expect(images(document)).toHaveLength(0);
    const streams = document.context.enumerateIndirectObjects().flatMap(([, value]) => value instanceof PDFRawStream && !value.dict.has(PDFName.of('Subtype')) ? [new TextDecoder().decode(decodePDFRawStream(value).decode())] : []);
    expect(streams.some(s => s.includes(' m\n') && s.includes(' l\n') && s.includes('f\n'))).toBe(true);
  });
  it('keeps rotated original pages as vector PDF forms instead of flattening them', async () => {
    const source = await PDFDocument.create();
    for (const rotation of [0, 90, 180, 270]) { const p = source.addPage([400, 600]); p.setRotation(degrees(rotation)); p.drawRectangle({ x: 20, y: 30, width: 100, height: 80, color: rgb(.2, .3, .7) }); }
    const bytes = await source.save();
    const { note, page } = createNote('Rotations', '#b9cee5', null);
    const pages: Page[] = [0, 90, 180, 270].map((rotation, i) => ({ ...page, id: String(i), pdfAssetId: 'original', pdfIndex: i + 1, width: rotation % 180 ? 600 : 400, height: rotation % 180 ? 400 : 600, items: [] }));
    note.pageIds = pages.map(p => p.id);
    const asset: Asset = { id: 'original', noteId: note.id, name: 'source.pdf', blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }) };
    const document = await PDFDocument.load(await renderPDF(note, async id => pages.find(p => p.id === id), async () => asset, () => {}));
    expect(images(document)).toHaveLength(0);
    expect(document.getPages().map(p => [p.getWidth(), p.getHeight(), p.getRotation().angle])).toEqual([[400, 600, 0], [600, 400, 0], [400, 600, 0], [600, 400, 0]]);
    const forms = document.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype'))?.toString() === '/Form');
    expect(forms).toHaveLength(3);
  });
});
