import { mkdir, cp } from 'node:fs/promises';
import sharp from 'sharp';
await mkdir('public', { recursive: true });
const iconSource = 'assets/notelin-app-icon-flat.png';
const { width, height } = await sharp(iconSource).metadata();
if (!width || !height) throw new Error('Notelin icon source has no dimensions.');
const side = Math.max(width, height);
const squareIcon = await sharp(iconSource).extend({
  top: Math.floor((side - height) / 2), bottom: Math.ceil((side - height) / 2),
  left: Math.floor((side - width) / 2), right: Math.ceil((side - width) / 2),
  background: '#ffffff'
}).png().toBuffer();
for (const size of [192, 512]) await sharp(squareIcon).resize(size, size).png().toFile(`public/notelin-flat-icon-${size}.png`);
await sharp(squareIcon).resize(384, 384).extend({ top: 64, bottom: 64, left: 64, right: 64, background: '#ffffff' }).png().toFile('public/notelin-flat-icon-maskable.png');
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) await cp(`node_modules/pdfjs-dist/${dir}`, `public/pdf/${dir}`, { recursive: true });
// Keep this stable URL for workers installed before the receiver was bundled.
await cp('src/pwa/share-target-sw.js', 'public/share-target-sw.js');
console.log('App icons and offline PDF resources prepared.');
