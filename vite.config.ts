import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
const releaseRevision = process.env.GITHUB_SHA || `version-${packageVersion}`;

export default defineConfig({
  base: '/mynotes/',
  define: { __NOTELIN_RELEASE__: JSON.stringify(releaseRevision) },
  plugins: [{
    name: 'notelin-release-marker',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({ revision: releaseRevision }) });
      this.emitFile({ type: 'asset', fileName: 'release-worker.js', source: `self.addEventListener('message', event => { if (event.data?.type === 'NOTELIN_RELEASE') event.ports[0]?.postMessage({ revision: ${JSON.stringify(releaseRevision)} }); });` });
    }
  }, VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.js',
    registerType: 'prompt',
    injectRegister: null,
    includeAssets: ['notelin-flat-icon-192.png', 'notelin-flat-icon-512.png'],
    // index.html selects the Samsung-compatible or full manifest before app startup.
    manifest: false,
    injectManifest: {
      rollupFormat: 'iife',
      // Keep Korean PDF CMaps offline; fetch other language maps only when a PDF needs them.
      // Avoid hundreds of requests in the service worker's first install event.
      globPatterns: ['**/*.{js,mjs,css,html,png,webp,svg,woff2,wasm,pfb,ttf,webmanifest}', 'pdf/cmaps/UniKS-*.bcmap', 'pdf/cmaps/Adobe-Korea1-*.bcmap'],
      globIgnores: ['**/repair.html', '**/release-worker.js', '**/share-target-sw.js'],
      maximumFileSizeToCacheInBytes: 12000000,
    },
    devOptions: { enabled: false }
  })],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 }
});
