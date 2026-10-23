import { PDFDict, PDFName, PDFOperator, type PDFOperatorNames, type PDFPage, concatTransformationMatrix, pushGraphicsState, popGraphicsState, setGraphicsState, moveTo, lineTo, closePath, fill } from 'pdf-lib';
import type { Stroke } from './model';
import { graphiteMaterial, graphiteOffset, graphiteSize, graphiteScale, pencilLayers } from '../engine/graphite';

const patterns = new WeakMap<PDFPage, Map<string, PDFName>>();
const number = (value: number) => String(Math.round(value * 1000) / 1000);
export function graphitePDF(page: PDFPage, stroke: Stroke, height: number) {
  const context = page.doc.context, offset = graphiteOffset(stroke.textureSeed), key = `${stroke.color}:${offset.x}:${offset.y}`;
  let cache = patterns.get(page); if (!cache) patterns.set(page, cache = new Map());
  let name = cache.get(key);
  if (!name) {
    const ext = context.obj({}); let content = `${[1, 3, 5].map(i => number(parseInt(stroke.color.slice(i, i + 2), 16) / 255)).join(' ')} rg\n`;
    graphiteMaterial().forEach((layer, i) => {
      ext.set(PDFName.of(`G${i}`), context.obj({ Type: 'ExtGState', ca: layer.opacity, CA: layer.opacity }));
      content += `/G${i} gs\n`;
      for (const polygon of layer.polygons) content += polygon.map((p, i) => `${number(p.x)} ${number(p.y)} ${i ? 'l' : 'm'}`).join('\n') + '\nh\n';
      content += 'f\n';
    });
    const pattern = context.register(context.flateStream(content, { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1,
      BBox: [0, 0, graphiteSize, graphiteSize], XStep: graphiteSize, YStep: graphiteSize,
      Matrix: [graphiteScale, 0, 0, -graphiteScale, offset.x, height - offset.y], Resources: { ExtGState: ext } }));
    const resources = page.node.normalizedEntries().Resources;
    let dictionary = resources.lookupMaybe(PDFName.of('Pattern'), PDFDict);
    if (!dictionary) { dictionary = context.obj({}); resources.set(PDFName.of('Pattern'), dictionary); }
    name = dictionary.uniqueKey('Graphite'); dictionary.set(name, pattern); cache.set(key, name);
  }
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, 0, height),
    PDFOperator.of('cs' as PDFOperatorNames, [PDFName.of('Pattern')]), PDFOperator.of('scn' as PDFOperatorNames, [name]));
  for (const layer of pencilLayers(stroke)) {
    const opacity = page.node.newExtGState('GraphitePressure', context.obj({ Type: 'ExtGState', ca: layer.opacity, CA: layer.opacity }));
    page.pushOperators(setGraphicsState(opacity));
    let operators: PDFOperator[] = [];
    for (const polygon of layer.polygons) {
      operators.push(moveTo(polygon[0].x, polygon[0].y), ...polygon.slice(1).map(p => lineTo(p.x, p.y)), closePath());
      if (operators.length > 1000) { page.pushOperators(...operators); operators = []; }
    }
    page.pushOperators(...operators, fill());
  }
  page.pushOperators(popGraphicsState());
}
