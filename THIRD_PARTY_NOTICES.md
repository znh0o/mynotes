# Third-party software

Runtime packages are locked in `package-lock.json`.

| Package | License | Purpose |
| --- | --- | --- |
| Dexie | Apache-2.0 | IndexedDB transactions |
| PDF.js / pdfjs-dist | Apache-2.0 | PDF reading, rendering, offline CMaps and decoders |
| pdf-lib | MIT | PDF creation and original PDF page copying |
| Lucide | ISC | Interface icons |
| Workbox | MIT | Service worker and precaching |

Vite, TypeScript, vite-plugin-pwa, Vitest, Playwright, fake-indexeddb and sharp are development dependencies. Their license files remain in their npm packages.

The build copies PDF.js resources and their accompanying license files into `public/pdf/`. Some font/decoder resources include their own notices: retain those alongside the resources. PDF.js includes Liberation fonts under SIL Open Font License and Foxit standard fonts under their included license. The copied CMap/standard-font/wasm directories contain the authoritative resource license notices.

App icons and notebook illustrations were created as SVG/CSS for this project. No external fonts, image CDN, analytics, or account service is used.
