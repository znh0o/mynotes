import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/mynotes/',
  plugins: [VitePWA({
    registerType: 'prompt',
    injectRegister: null,
    includeAssets: ['icon-192.png', 'icon-512.png'],
    manifestFilename: 'manifest.webmanifest',
    manifest: {
      name: 'MyNotes — 생각이 머무는 곳', short_name: 'MyNotes', lang: 'ko',
      description: 'S펜과 함께하는 나만의 오프라인 학습 노트',
      start_url: '/mynotes/', scope: '/mynotes/', display: 'standalone',
      background_color: '#f7f9fc', theme_color: '#f7f9fc',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
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
