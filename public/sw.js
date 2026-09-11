const SHELL_CACHE = "wash-room-shell-v4";
// Root is network-only because Proxy chooses the public landing page or the
// authenticated workspace from the current session cookie.
const SHELL_PATHS = ["/login", "/offline.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_PATHS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/scan/") || url.pathname.startsWith("/auth/")) {
    return;
  }
  if (url.pathname.startsWith("/app") || url.pathname.startsWith("/account")) {
    return;
  }
  if (url.searchParams.has("token") || url.searchParams.has("qr")) {
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || SHELL_PATHS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(async () => cached ?? caches.match("/offline.html"));
        return cached ?? fetched;
      }),
    );
  }
});

self.addEventListener("sync", () => undefined);
self.addEventListener("message", () => undefined);
