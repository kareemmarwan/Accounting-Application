const VERSION = "v3";
const SHELL_CACHE = `shell-${VERSION}`;
const STATIC_CACHE = `static-${VERSION}`;

// مسارات التطبيق المحمية — تُخدم كاش أولاً وإعادة تحقق بالخلفية
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
  "/admin",
  "/onboarding"
];

// تُجلب مسبقاً عند التثبيت/الدخول (بلا مسارات محمية — تُخزَّن لاحقاً من التنقل الفعلي)
const BASE_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/login",
  "/register"
];

function isAppRoute(pathname) {
  return APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

async function putBoth(cache, request, response) {
  if (!response || !response.ok) return;
  try {
    await cache.put(response.url || request.url, response.clone());
    if (!response.redirected) {
      await cache.put(request.url, response.clone());
    }
  } catch (error) {
    void error;
  }
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    BASE_ASSETS.map((url) =>
      fetch(url, { cache: "reload" })
        .then((response) => putBoth(cache, new Request(url), response))
        .catch(() => undefined)
    )
  );
  return cache;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheShell()
      .catch(() => undefined)
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

// إعادة تخزين الصدفة بعد تسجيل الدخول (تُرسل الرسالة من LandingGate)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PRECACHE_APP_SHELL") {
    event.waitUntil(
      precacheShell().catch(() => undefined)
    );
  }
});

async function fallbackNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const exact = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (exact) return exact;

  const url = new URL(request.url);
  if (url.pathname === "/" || isAppRoute(url.pathname)) {
    for (const route of APP_ROUTES) {
      const cached = await cache.match(route, { ignoreSearch: true, ignoreVary: true });
      if (cached) return cached;
    }
    const root = await cache.match("/", { ignoreSearch: true, ignoreVary: true });
    if (root) return root;
  }

  const offline = await cache.match("/offline.html", { ignoreVary: true });
  if (offline) return offline;
  return new Response("دون اتصال", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

async function handleNavigation(request, event) {
  const url = new URL(request.url);
  const appRoute = url.pathname === "/" || isAppRoute(url.pathname);
  const cache = await caches.open(SHELL_CACHE);
  const cached = appRoute
    ? await cache.match(request, { ignoreSearch: true, ignoreVary: true })
    : null;

  const network = fetch(request)
    .then(async (response) => {
      await putBoth(cache, request, response);
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;
  return fallbackNavigation(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request, event));
    return;
  }

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest";

  if (isStatic) {
    event.respondWith(
      caches.match(request, { ignoreVary: true }).then(
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
