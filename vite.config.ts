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
    }
  }, VitePWA({
    registerType: 'prompt',
    injectRegister: null,
    includeAssets: ['notelin-flat-icon-192.png', 'notelin-flat-icon-512.png'],
    manifestFilename: 'manifest.webmanifest',
    manifest: {
      name: 'Notelin — 생각이 머무는 곳', short_name: 'Notelin', lang: 'ko',
      description: 'S펜과 함께하는 나만의 오프라인 학습 노트',
      start_url: '/mynotes/', scope: '/mynotes/', display: 'standalone',
      background_color: '#f7f9fc', theme_color: '#f7f9fc',
      icons: [
        { src: 'notelin-flat-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'notelin-flat-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'notelin-flat-icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ],
      share_target: {
        action: '/mynotes/share-target', method: 'POST', enctype: 'multipart/form-data',
        params: { files: [{ name: 'pdf', accept: ['application/pdf', '.pdf'] }] }
      }
    },
    workbox: {
      importScripts: ['share-target-sw.js'],
      globPatterns: ['**/*.{js,mjs,css,html,png,svg,woff2,wasm,bcmap,pfb,ttf}'],
      maximumFileSizeToCacheInBytes: 12000000,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      navigateFallback: '/mynotes/index.html',
      navigateFallbackDenylist: [/^\/api/]
    },
    devOptions: { enabled: false }
  })],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 }
});
