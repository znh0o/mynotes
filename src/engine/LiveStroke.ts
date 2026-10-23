import type { Point, Stroke } from '../data/model';
import { curvePiece, graphiteBand, graphiteOpacities, ribbon, type XY } from './graphite';
import { graphitePattern } from './graphite-pattern';
import { rememberBrush } from './render';

const append = (path: Path2D, polygons: XY[][]) => {
  for (const polygon of polygons) {
    path.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) path.lineTo(polygon[i].x, polygon[i].y);
    path.closePath();
  }
};

// Finalized quadratic pieces are appended once. Only the changing tip is
// rebuilt, and only its dirty rectangle is cleared/rasterized on each frame.
export class LiveStroke {
  private stroke?: Stroke;
  private chunks: { paths: Path2D[]; x: number; y: number; right: number; bottom: number; count: number }[] = [];
  private paths: Path2D[] = [];
  private next = 1;
  private tail: Point[] = [];
  reset() { this.stroke = undefined; this.paths = []; this.chunks = []; this.tail = []; this.next = 1; }
  private empty() { return Array.from({ length: this.stroke!.tool === 'pencil' ? 8 : 1 }, () => new Path2D()); }
  draw(ctx: CanvasRenderingContext2D, stroke: Stroke, ratio: number) {
    if (!['pencil', 'pen', 'highlighter'].includes(stroke.tool) || stroke.tool === 'pen' && stroke.pressure) return false;
    if (this.stroke !== stroke) {
      this.reset(); this.stroke = stroke;
    }
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    const visit = (p: Point) => { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); };
    this.tail.forEach(visit);
    const add = (paths: Path2D[], points: Point[]) => {
      points.forEach(visit);
      if (stroke.tool === 'pencil') append(paths[graphiteBand(points)], ribbon(points, stroke.width));
      else points.slice(1).forEach(p => paths[0].lineTo(p.x, p.y));
    };
    while (this.next < stroke.points.length - 1) {
      const piece = curvePiece(stroke.points, this.next++);
      let chunk = this.chunks[this.chunks.length - 1];
      if (!chunk || chunk.count >= 32) {
        chunk = { paths: this.empty(), x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity, count: 0 };
        chunk.paths[0].moveTo(piece[0].x, piece[0].y); this.chunks.push(chunk);
      }
      for (const p of piece) { chunk.x = Math.min(chunk.x, p.x); chunk.y = Math.min(chunk.y, p.y); chunk.right = Math.max(chunk.right, p.x); chunk.bottom = Math.max(chunk.bottom, p.y); }
      chunk.count++; add(chunk.paths, piece);
    }
    this.paths = this.empty();
    this.tail = stroke.points.length < 3 ? stroke.points : curvePiece(stroke.points, stroke.points.length - 1);
    this.tail.forEach(visit);
    const margin = stroke.width + 2 / ratio;
    // Round outwards in device pixels, including the old tip's antialias fringe.
    x = Math.floor((x - margin) * ratio) / ratio; y = Math.floor((y - margin) * ratio) / ratio;
    right = Math.ceil((right + margin) * ratio) / ratio; bottom = Math.ceil((bottom + margin) * ratio) / ratio;
    for (const chunk of this.chunks) if (chunk.right + margin >= x && chunk.bottom + margin >= y && chunk.x - margin <= right && chunk.y - margin <= bottom) {
      chunk.paths.forEach((path, i) => this.paths[i].addPath(path));
    }
    this.paths[0].moveTo(this.tail[0].x, this.tail[0].y); add(this.paths, this.tail);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, right - x, bottom - y); ctx.clip();
    ctx.clearRect(x, y, right - x, bottom - y); this.paint(ctx); ctx.restore();
    return true;
  }
  private paint(ctx: CanvasRenderingContext2D) {
    const stroke = this.stroke!;
    ctx.save(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (stroke.tool === 'pencil') {
      ctx.fillStyle = graphitePattern(ctx, stroke.color, stroke.textureSeed);
      this.paths.forEach((path, i) => { ctx.globalAlpha = graphiteOpacities[i]; ctx.fill(path); });
    } else {
      ctx.globalAlpha = stroke.tool === 'highlighter' ? .32 : 1;
      ctx.strokeStyle = ctx.fillStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.lineCap = ctx.lineJoin = 'round';
      if (stroke.points.length === 1) { ctx.beginPath(); ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.stroke(this.paths[0]);
    }
    ctx.restore();
  }
  commit(stroke: Stroke) {
    if (stroke !== this.stroke) return false;
    if (stroke.tool === 'pencil') {
      const paths = this.empty();
      for (const chunk of this.chunks) chunk.paths.forEach((path, i) => paths[i].addPath(path));
      append(paths[graphiteBand(this.tail)], ribbon(this.tail, stroke.width));
      rememberBrush(stroke, paths.map((path, i) => ({ path, opacity: graphiteOpacities[i] })));
    }
    return true;
  }
}
