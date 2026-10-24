# Installation preview assets

The three notelin-*-preview.webp assets are captured from the real app in a disposable browser profile. The landing page never seeds examples into user databases.

user-science-notes.png contains the page portion of the user's supplied 필기.jpg, included at their explicit request. System bars and the source application's toolbar are excluded. It is imported as a page image for the first preview; it does not represent handwriting produced with Notelin's pen engine. No Goodnotes promotional artwork is included.

Other study notes and PDF examples are original content in scripts/capture-install-demo.mjs.

Run a local Vite preview on port 4173, then node scripts/capture-install-demo.mjs to regenerate. Rebuild afterward to update the service worker precache.
