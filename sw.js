var CACHE_NAME = "prijem-robe-v1";
var urlsToCache = [
  "./index.html",
  "./dashboard.html",
  "./priprema.html",
  "./skeniranje.html",
  "./css/style.css",
  "./js/github.js",
  "./js/auth.js",
  "./js/pdfParser.js",
  "./js/scanner.js",
  "./icons/logo.svg"
];

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("fetch", function(event) {
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});
