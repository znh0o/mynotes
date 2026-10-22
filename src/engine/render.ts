import type { Item, Page, Point, Stroke } from '../data/model';
export const imageCache = new Map<string, HTMLImageElement>();

function smooth(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const output: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1] || b;
    const start = i === 1 ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2, t: a.t };
    const end = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2, p: (b.p + c.p) / 2, t: b.t };
    const steps = Math.max(2, Math.min(12, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 3)));
    for (let n = 1; n <= steps; n++) {
      const t = n / steps, u = 1 - t;
      output.push({ x: u * u * start.x + 2 * u * t * b.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * b.y + t * t * end.y,
        p: start.p + (end.p - start.p) * t, t: b.t });
    }
  }
  output.push(points[points.length - 1]);
  return output;
}
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (!stroke.points.length) return;
  const pts = smooth(stroke.points);
  ctx.save(); ctx.fillStyle = stroke.color; ctx.strokeStyle = stroke.color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (stroke.tool === 'highlighter' || !stroke.pressure) {
    ctx.globalAlpha = stroke.tool === 'highlighter' ? .32 : 1;
    ctx.lineWidth = stroke.width;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    if (pts.length === 1) { ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.stroke();
  } else {
    const left: {x: number; y: number}[] = [], right: {x: number; y: number}[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)], p = pts[i];
      const angle = Math.atan2(next.y - prev.y, next.x - prev.x) + Math.PI / 2;
      const radius = stroke.width * (.22 + .78 * Math.pow(Math.max(.05, p.p), .65)) / 2;
      left.push({ x: p.x + Math.cos(angle) * radius, y: p.y + Math.sin(angle) * radius });
      right.push({ x: p.x - Math.cos(angle) * radius, y: p.y - Math.sin(angle) * radius });
    }
    ctx.beginPath(); ctx.moveTo(left[0].x, left[0].y);
    left.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    right.reverse().forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.fill();
    for (const p of [pts[0], pts[pts.length - 1]]) {
      ctx.beginPath(); ctx.arc(p.x, p.y, stroke.width * (.22 + .78 * Math.pow(Math.max(.05, p.p), .65)) / 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
export function drawItem(ctx: CanvasRenderingContext2D, item: Item) {
  if (item.kind === 'stroke') return drawStroke(ctx, item);
  ctx.save();
  if (item.kind === 'text') {
    ctx.fillStyle = item.color; ctx.font = `400 ${item.size}px "Segoe UI", "Malgun Gothic", sans-serif`;
    ctx.textBaseline = 'top';
    item.text.split('\n').forEach((line, index) => ctx.fillText(line, item.x, item.y + index * item.size * 1.55));
  } else if (item.kind === 'image') {
    const image = imageCache.get(item.assetId); if (image) ctx.drawImage(image, item.x, item.y, item.w, item.h);
  } else {
    ctx.strokeStyle = item.color; ctx.lineWidth = item.width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
    if (item.shape === 'line') { ctx.moveTo(item.x, item.y); ctx.lineTo(item.x + item.w, item.y + item.h); }
    if (item.shape === 'rect') ctx.rect(item.x, item.y, item.w, item.h);
    if (item.shape === 'ellipse') ctx.ellipse(item.x + item.w / 2, item.y + item.h / 2, Math.abs(item.w / 2), Math.abs(item.h / 2), 0, 0, Math.PI * 2);
    if (item.shape === 'triangle') { ctx.moveTo(item.x + item.w / 2, item.y); ctx.lineTo(item.x + item.w, item.y + item.h); ctx.lineTo(item.x, item.y + item.h); ctx.closePath(); }
    ctx.stroke();
  }
  ctx.restore();
}
export function drawPaper(ctx: CanvasRenderingContext2D, page: Page) {
  const { width: w, height: h, spacing: s, paper } = page;
  ctx.fillStyle = page.paperColor; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#bdc9d64d'; ctx.fillStyle = '#b3bfce99'; ctx.lineWidth = .8;
  ctx.beginPath();
  if (paper === 'lined' || paper === 'cornell') for (let y = 96; y < h - 55; y += s) { ctx.moveTo(48, y); ctx.lineTo(w - 48, y); }
  if (paper === 'grid') {
    for (let x = 32; x < w - 20; x += s) { ctx.moveTo(x, 32); ctx.lineTo(x, h - 32); }
    for (let y = 32; y < h - 20; y += s) { ctx.moveTo(32, y); ctx.lineTo(w - 32, y); }
  }
  if (paper === 'dots') for (let y = 40; y < h - 20; y += s) for (let x = 40; x < w - 20; x += s) { ctx.moveTo(x, y); ctx.arc(x, y, 1, 0, Math.PI * 2); }
  if (paper === 'cornell') { ctx.moveTo(w * .27, 64); ctx.lineTo(w * .27, h - 200); ctx.moveTo(48, h - 200); ctx.lineTo(w - 48, h - 200); }
  if (paper === 'planner') {
    ctx.font = '20px sans-serif'; ctx.fillStyle = '#8396ab'; ctx.fillText('W E E K L Y   P L A N', 48, 65);
    ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach((day, i) => {
      const y = 108 + (h - 156) / 7 * i;
      ctx.font = '12px sans-serif'; ctx.fillText(day, 50, y + 26);
      ctx.moveTo(48, y); ctx.lineTo(w - 48, y); ctx.moveTo(112, y); ctx.lineTo(112, y + (h - 156) / 7);
    });
  }
  if (paper === 'dots') ctx.fill(); else ctx.stroke();
}
export function drawItems(ctx: CanvasRenderingContext2D, items: Item[]) { items.forEach(item => drawItem(ctx, item)); }
