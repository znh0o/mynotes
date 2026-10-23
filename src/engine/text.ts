import type { TextItem } from '../data/model';

export const textFont = (item: TextItem) => `${item.italic ? 'italic ' : ''}${item.bold ? 700 : 400} ${item.size}px "Segoe UI", "Malgun Gothic", sans-serif`;

// Share wrapping between the page, thumbnails and PDF. Old text boxes keep
// their explicit line breaks until edited with the inline editor.
export function textLines(item: TextItem, measure: (text: string) => number) {
  if (!item.wrap) return item.text.split('\n');
  const lines: string[] = [];
  for (const paragraph of item.text.split('\n')) {
    let line = '';
    // Whitespace boundaries preserve words; long words and Korean can wrap
    // between characters, like the native textarea used while typing.
    for (const token of paragraph.match(/[A-Za-z0-9_]+|[^A-Za-z0-9_]/gu) ?? []) {
      if (line && measure(line + token) > item.w) { lines.push(line); line = ''; }
      for (const character of token) {
        if (line && measure(line + character) > item.w) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function drawText(ctx: CanvasRenderingContext2D, item: TextItem) {
  ctx.fillStyle = item.color; ctx.font = textFont(item); ctx.textBaseline = 'top';
  ctx.textAlign = item.align ?? 'left';
  const x = item.x + (item.align === 'center' ? item.w / 2 : item.align === 'right' ? item.w : 0);
  textLines(item, text => ctx.measureText(text).width).forEach((line, i) => ctx.fillText(line, x, item.y + (item.wrap ? item.size * .275 : 0) + i * item.size * 1.55));
}
