import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:3000";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} | ${name} | ${detail}`);
}

function base64url(str) {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fakeJwt() {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: "00000000-0000-0000-0000-000000000001",
      email: "offline-audit@example.com",
      aud: "authenticated",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 86400,
      iat: Math.floor(Date.now() / 1000)
    })
  );
  return `${header}.${payload}.fake-signature`;
}

function buildSessionCookie(supabaseUrl) {
  const ref = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!ref) return null;
  const session = {
    access_token: fakeJwt(),
    token_type: "bearer",
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    refresh_token: "fake-refresh-token",
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      aud: "authenticated",
      email: "offline-audit@example.com",
      role: "authenticated"
    }
  };
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${base64url(JSON.stringify(session))}`
  };
}

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

const supabaseUrl = await (
  await import("node:fs/promises")
)
  .readFile(".env.local", "utf8")
  .then((content) => content.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim());

const server = spawn("cmd", ["/c", "npm run start > server-audit.log 2>&1"], {
  cwd: process.cwd(),
  stdio: "ignore"
});

let browser = null;

try {
  if (!(await waitReady())) throw new Error("server did not start");

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox"]
  });
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");

  // ==== أونلاين: تسجيل SW + precache كامل ====
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: "PRECACHE_APP_SHELL" });
    return { active: !!reg.active };
  });
  report("SW active", swState.active, JSON.stringify(swState));
  await sleep(10000);

  // التحقق من أن أصول الصفحات (chunks) خُزّنت مع الـ precache
  const cacheAudit = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith("shell-"));
    const staticCache = names.find((n) => n.startsWith("static-"));
    const shellKeys = shell
      ? (await (await caches.open(shell)).keys()).map((k) => new URL(k.url).pathname)
      : [];
    const staticKeys = staticCache
      ? (await (await caches.open(staticCache)).keys()).map((k) => new URL(k.url).pathname)
      : [];
    return { shellKeys, staticKeys };
  });
  const shellUnique = [...new Set(cacheAudit.shellKeys)];
  const appChunkCount = cacheAudit.staticKeys.filter((k) =>
    k.startsWith("/_next/static/chunks/app/")
  ).length;
  report(
    "precache: مسارات + chunks صفحات",
    shellUnique.length >= 6 && appChunkCount >= 3,
    `shell=${shellUnique.length} مسار, appChunks=${appChunkCount}`
  );

  // تطابق: أصول HTML المستخرجة كلها مخزّنة
  const htmlAssetCoverage = await page.evaluate(async () => {
    const res = await fetch("/login", { cache: "no-store" });
    const html = await res.text();
    const urls = new Set();
    const re = /<(?:script|link|img|source)[^>]+\b(?:src|href)="(\/_next\/[^"]+)"/g;
    let m;
    while ((m = re.exec(html))) urls.add(m[1]);
    const names = await caches.keys();
    const staticCache = names.find((n) => n.startsWith("static-"));
    const keys = new Set(
      staticCache
        ? (await (await caches.open(staticCache)).keys()).map((k) => new URL(k.url).pathname)
        : []
    );
    const missing = [...urls].filter((u) => !keys.has(u));
    return { total: urls.size, missing };
  });
  report(
    "كل أصول صفحة /login مخزّنة",
    htmlAssetCoverage.missing.length === 0,
    `assets=${htmlAssetCoverage.total} missing=${JSON.stringify(htmlAssetCoverage.missing)}`
  );

  // ==== قتل الخادم ====
  const kill = spawn("taskkill", ["/F", "/T", "/PID", String(server.pid)], { stdio: "ignore" });
  await new Promise((r) => kill.on("exit", r));
  await sleep(2000);
  let dead = false;
  try {
    await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000) });
  } catch {
    dead = true;
  }
  report("الخادم متوقف", dead, `reachable=${!dead}`);

  // ==== أوف لاين + جلسة مزيفة (محاكاة مستخدم مسجّل) ====
  const cookie = buildSessionCookie(supabaseUrl);
  report("كوكي جلسة مزيف", !!cookie, cookie ? cookie.name : "ref not found");
  if (cookie) {
    await cdp.send("Network.setCookie", {
      name: cookie.name,
      value: cookie.value,
      domain: "127.0.0.1",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 86400
    });
  }

  // سيناريو الحلقة: /dashboard غير مخزّن + جلسة → يجب offline.html (لا حلقة)
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 30000 });
  await sleep(5000);
  const loopState = await page.evaluate(() => ({
    url: location.pathname,
    offlineText: document.body.innerText.includes("لا يوجد اتصال"),
    reloads: performance.getEntriesByType("navigation").length
  }));
  report(
    "أوفلاين مسجّل: /dashboard → offline.html (بلا حلقة)",
    loopState.offlineText && loopState.url === "/dashboard",
    `url=${loopState.url} offlinePage=${loopState.offlineText} navEntries=${loopState.reloads}`
  );

  // مسار مجهول أوفلاين → offline.html
  await page.goto(`${BASE}/no-such-page`, { waitUntil: "load", timeout: 30000 });
  await sleep(3000);
  const unknownState = await page.evaluate(() => ({
    url: location.pathname,
    offlineText: document.body.innerText.includes("لا يوجد اتصال")
  }));
  report(
    "أوفلاين مسار مجهول → offline.html",
    unknownState.offlineText,
    `url=${unknownState.url} offlinePage=${unknownState.offlineText}`
  );
} catch (err) {
  report("unexpected", false, String(err?.message ?? err));
} finally {
  if (browser) await browser.close().catch(() => {});
  try {
    const k = spawn("taskkill", ["/F", "/T", "/PID", String(server.pid)]);
    await new Promise((r) => k.on("exit", r));
  } catch {}
}

const failedCount = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failedCount}/${results.length} passed ===`);
process.exit(failedCount ? 1 : 0);
