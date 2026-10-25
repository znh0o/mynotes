import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import './pwa/share-target-sw.js';

// Bundle the worker, version responder and PDF share receiver into one script.
// Updating an installed app must not depend on loading more worker scripts.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${import.meta.env.BASE_URL}index.html`), {
  denylist: [/^\/api/, /\/repair\.html$/]
}));
registerRoute(/\/mynotes\/pdf\/cmaps\/.*\.bcmap$/, new CacheFirst({
  cacheName: 'notelin-pdf-cmaps-v1',
  plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 })]
}));
self.addEventListener('message', event => {
  if (event.data?.type === 'NOTELIN_RELEASE') event.ports[0]?.postMessage({ revision: __NOTELIN_RELEASE__ });
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
clientsClaim();
