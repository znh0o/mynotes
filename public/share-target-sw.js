// The static GitHub Pages site cannot receive POST requests, so keep the shared
// PDF in local Cache Storage before opening the app. The app deletes it after import.
const notelinScope = new URL(self.registration.scope);
const notelinShareAction = new URL('share-target', notelinScope);
const notelinSharedCache = 'notelin-shared-pdfs-v1';

self.addEventListener('fetch', event => {
  if (event.request.method !== 'POST' || new URL(event.request.url).pathname !== notelinShareAction.pathname) return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const pdf = form.get('pdf');
      const name = pdf && typeof pdf.name === 'string' ? pdf.name : '공유한 PDF.pdf';
      if (!pdf || typeof pdf.size !== 'number' || !pdf.size ||
          !(name.toLowerCase().endsWith('.pdf') || pdf.type === 'application/pdf')) {
        return Response.redirect(new URL('?share-error=type', notelinScope), 303);
      }
      if (pdf.size > 150 * 1024 * 1024) {
        return Response.redirect(new URL('?share-error=size', notelinScope), 303);
      }
      const token = crypto.randomUUID();
      const key = new URL(`shared-pdf/${token}`, notelinScope);
      const cache = await caches.open(notelinSharedCache);
      await cache.put(key, new Response(pdf, {
        headers: { 'Content-Type': 'application/pdf', 'X-Notelin-Filename': encodeURIComponent(name) }
      }));
      const entries = await cache.keys();
      await Promise.all(entries.slice(0, -5).map(entry => cache.delete(entry)));
      return Response.redirect(new URL(`?shared-pdf=${token}`, notelinScope), 303);
    } catch (error) {
      console.error('Could not receive shared PDF', error);
      return Response.redirect(new URL('?share-error=storage', notelinScope), 303);
    }
  })());
});
