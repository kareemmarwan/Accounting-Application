const VERSION = "v6";
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

const AUTH_PATHS = new Set(["/login", "/register"]);

function isAppRoute(pathname) {
  return APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

function isAuthPath(url) {
  try {
    return AUTH_PATHS.has(new URL(url).pathname);
  } catch (error) {
    void error;
    return false;
  }
}

// Safari/WebKit يرفض استجابات التنقل التي يخدمها SW إذا كانت محمّلة تاريخ تحويلات
// (redirected: true) — يظهر بذلك الخطأ "response served by service worker has redirections".
// الحل الجذري: إعادة بناء الاستجابة نظيفة بلا علامة التحويل قبل خدمتها أو تخزينها.
async function sanitizeResponse(response) {
  if (!response || !response.redirected) return response;
  const finalUrl = response.url;
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.delete("location");
  const clean = new Response(body, {
    status: response.status,
    statusText: "",
    headers
  });
  Object.defineProperty(clean, "url", { value: finalUrl });
  return clean;
}

async function putBoth(cache, request, response) {
  if (!response) return undefined;
  if (
    response.redirected &&
    isAuthPath(response.url) &&
    !isAuthPath(request.url)
  ) {
    return sanitizeResponse(response);
  }
  const clean = await sanitizeResponse(response);
  if (!clean || !clean.ok) return clean;
  try {
    await cache.put(clean.url || request.url, clean.clone());
  } catch (error) {
    void error;
  }
  return clean;
}

// استخراج أصول /_next/static من HTML الصفحة — لضمان عمل الصفحة أوف لاين حتى لو لم تُزر من قبل
function extractAssets(html) {
  const urls = new Set();
  const patterns = [
    /<(?:script|link|img|source)[^>]+\b(?:src|href)="(\/_next\/[^"]+)"/g,
    /<link[^>]+\bhref="(\/_next\/[^"]+\.css)"/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      urls.add(match[1]);
    }
  }
  return [...urls];
}

async function precacheAsset(staticCache, assetPath, baseUrl) {
  try {
    const assetUrl = new URL(assetPath, baseUrl).href;
    const existing = await staticCache.match(assetUrl, { ignoreVary: true });
    if (existing) return;
    const assetResponse = await fetch(assetUrl, { cache: "reload" });
    if (assetResponse.ok) {
      await staticCache.put(assetUrl, assetResponse.clone());
    }
  } catch (error) {
    void error;
  }
}

async function precacheShell(includeAppRoutes) {
  const urls = includeAppRoutes ? BASE_ASSETS.concat(APP_ROUTES) : BASE_ASSETS;
  const cache = await caches.open(SHELL_CACHE);
  const staticCache = await caches.open(STATIC_CACHE);
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (!response.ok) return;
        const contentType = response.headers.get("content-type") || "";
        const isHtml = contentType.includes("text/html");
        const html = isHtml ? await response.clone().text() : null;
        await putBoth(cache, new Request(url), response);
        if (html) {
          const assets = extractAssets(html);
          const pageUrl = new URL(url, self.location.origin).href;
          await Promise.all(
            assets.map((asset) => precacheAsset(staticCache, asset, pageUrl))
          );
        }
      } catch (error) {
        void error;
      }
    })
  );
  return cache;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheShell(false)
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
      precacheShell(true).catch(() => undefined)
    );
  }
});

async function serveOffline() {
  const cache = await caches.open(SHELL_CACHE);
  const offline = await cache.match("/offline.html", { ignoreVary: true });
  if (offline) return offline;
  return new Response("دون اتصال", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

async function fallbackNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const exact = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (exact) return sanitizeResponse(exact);

  // لا تخدم "/" كبديل لمسارات التطبيق — مع جلسة نشطة تسبّب حلقة إعادة توجيه لا نهائية
  return serveOffline();
}

async function handleNavigation(request, event) {
  const url = new URL(request.url);
  const appRoute = url.pathname === "/" || isAppRoute(url.pathname);
  const cache = await caches.open(SHELL_CACHE);
  const cached = appRoute
    ? await cache.match(request, { ignoreSearch: true, ignoreVary: true })
    : null;

  const network = fetch(request)
    .then((response) => putBoth(cache, request, response))
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return sanitizeResponse(cached);
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
    url.pathname.startsWith("/_next/image") ||
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
