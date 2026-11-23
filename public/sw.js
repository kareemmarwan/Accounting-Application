const VERSION = "v2";
const SHELL_CACHE = `shell-${VERSION}`;
const STATIC_CACHE = `static-${VERSION}`;

const SHELL_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/login",
  "/register",
  "/dashboard",
  "/pos",
  "/sales",
  "/products",
  "/purchases",
  "/debts",
  "/contacts",
  "/expenses",
  "/accounts",
  "/reports",
  "/settings"
];

// مسارات التطبيق المحمية — لا تُستبدل أبداً بلينديج بيج عند انقطاع الشبكة
const APP_ROUTES = [
  "/dashboard",
  "/pos",
  "/sales",
  "/products",
  "/purchases",
  "/debts",
  "/contacts",
  "/expenses",
  "/accounts",
  "/reports",
  "/settings",
  "/onboarding"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.all(
          SHELL_ASSETS.map((url) =>
            fetch(url)
              .then((response) => {
                if (!response.ok || response.redirected) return;
                return cache.put(url, response).catch(() => undefined);
              })
              .catch(() => undefined)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheNavigation(request, response) {
  if (!response.ok || response.redirected) return;
  try {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, response.clone());
  } catch (error) {
    void error;
  }
}

async function fallbackNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const exact = await cache.match(request, { ignoreSearch: true });
  if (exact) return exact;

  const url = new URL(request.url);
  if (APP_ROUTES.some((route) => url.pathname === route || url.pathname.startsWith(`${route}/`))) {
    for (const route of APP_ROUTES) {
      const cached = await cache.match(route, { ignoreSearch: true });
      if (cached) return cached;
    }
  }

  const offline = await cache.match("/offline.html");
  if (offline) return offline;
  return new Response("دون اتصال", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          await cacheNavigation(request, response);
          return response;
        })
        .catch(() => fallbackNavigation(request))
    );
    return;
  }

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest";

  if (isStatic) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then(async (response) => {
            if (response.ok) {
              try {
                const cache = await caches.open(STATIC_CACHE);
                await cache.put(request, response.clone());
              } catch (error) {
                void error;
              }
            }
            return response;
          })
      )
    );
  }
});
