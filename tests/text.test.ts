import { it, expect } from 'vitest';
import { splitDocument, textFont, textLines } from '../src/engine/text';
import type { TextItem } from '../src/data/model';
const item: TextItem = { id: 'text', kind: 'text', x: 10, y: 20, w: 50, h: 40, size: 22, text: '한글을 길게 입력해요\n\nhello world', color: '#30445e' };
it('preserves legacy explicit breaks and wraps new Korean/English boxes to their saved width', () => {
  const measure = (line: string) => [...line].length * 10;
  expect(textLines(item, measure)).toEqual(item.text.split('\n'));
  const lines = textLines({ ...item, wrap: true }, measure);
  expect(lines.every(line => measure(line) <= item.w)).toBe(true);
  expect(lines.join('')).toBe(item.text.replaceAll('\n', ''));
  expect(lines).toContain(''); expect(lines).toContain('hello'); expect(lines).toContain('world');
});
it('keeps font weight and slant in the shared page/PDF font', () => {
  expect(textFont({ ...item, bold: true, italic: true })).toMatch(/^italic 700 22px/);
  expect(textFont(item)).toMatch(/^400 22px/);
});
it('splits flowing body text without losing spaces, explicit line breaks or Korean characters', () => {
  const source = '한글과 English words를 씁니다.\n\n다음 문단도 그대로 남아요.\n마지막 줄';
  let remaining = source, joined = '', pages = 0;
  while (remaining) {
    const [head, tail] = splitDocument({ ...item, y: 64, w: 100, text: remaining, wrap: true }, { height: 230 }, text => [...text].length * 10);
    expect(head.length).toBeGreaterThan(0); joined += head; remaining = tail; pages++;
  }
  expect(pages).toBeGreaterThan(1); expect(joined).toBe(source);
});
