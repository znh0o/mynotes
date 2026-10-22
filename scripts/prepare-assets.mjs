import { mkdir, cp, readFile } from 'node:fs/promises';
import sharp from 'sharp';
await mkdir('public', { recursive: true });
const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="112" fill="#edf3fb"/><rect x="123" y="102" width="265" height="320" rx="26" fill="#769cc9"/><path d="M158 103v318" stroke="#a2bee0" stroke-width="7"/><path d="M210 316l17-61L333 149q14-14 28 0t0 28L255 283z" fill="#fffefa"/><path d="M229 256l26 27M210 316l45-33" fill="none" stroke="#c9daef" stroke-width="8" stroke-linejoin="round"/><path d="M209 356h116" stroke="#b9cfe9" stroke-width="9" stroke-linecap="round"/></svg>`;
for (const size of [192, 512]) await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icon-${size}.png`);
await sharp(Buffer.from(svg)).resize(360, 360).extend({ top: 76, bottom: 76, left: 76, right: 76, background: '#edf3fb' }).png().toFile('public/icon-maskable.png');
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) await cp(`node_modules/pdfjs-dist/${dir}`, `public/pdf/${dir}`, { recursive: true });
console.log('App icons and offline PDF resources prepared.');
