// App-shell cache only. Game data (/api, /ws) always goes to the network.
const CACHE = "saladbowl-shell-v1"
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])).then(() => self.skipWaiting()))
})
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== "GET" || url.origin !== location.origin) return
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws" || url.pathname === "/healthz") return
  if (url.pathname.startsWith("/assets/")) {
    // hashed file names: cache first
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()))
            return res
          }),
      ),
    )
    return
  }
  if (e.request.mode === "navigate") {
    // network first so a new deploy shows up; offline falls back to the cached shell
    e.respondWith(fetch(e.request).catch(() => caches.match("/")))
  }
})
