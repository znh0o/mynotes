import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const source = 'public/notelin-flat-icon-512.png';
for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
  const directory = `android/app/src/main/res/mipmap-${density}`;
  await mkdir(directory, { recursive: true });
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    await sharp(source).resize(Math.round(48 * scale), Math.round(48 * scale)).png().toFile(`${directory}/${name}.png`);
  }
  await sharp(source).resize(Math.round(72 * scale), Math.round(72 * scale))
    .extend({ top: Math.round(18 * scale), bottom: Math.round(18 * scale), left: Math.round(18 * scale), right: Math.round(18 * scale), background: '#ffffff' })
    .png().toFile(`${directory}/ic_launcher_foreground.png`);
}
console.log('Notelin Android icons prepared.');
