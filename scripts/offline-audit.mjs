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

const server = spawn("cmd", ["/c", "npm run start > server-audit.log 2>&1"], {
  cwd: process.cwd(),
  shell: false,
  stdio: "ignore",
  detached: false
});

let browser = null;
let failed = false;

try {
  const up = await waitReady();
  if (!up) throw new Error("server did not start");

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox"]
  });
  const page = await browser.newPage();

  // ==== المرحلة أ: أونلاين ====
  const respRoot = await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });
  report("online /", respRoot.ok(), `status=${respRoot.status()}`);

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1200);

  const swInfo = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith("shell-"));
    const keys = shell ? await (await caches.open(shell)).keys() : [];
    return {
      active: !!reg.active,
      routes: keys.map((k) => new URL(k.url).pathname)
    };
  });
  report(
    "SW active + shell cached",
    swInfo.active && swInfo.routes.includes("/login") && swInfo.routes.includes("/"),
    JSON.stringify(swInfo.routes)
  );

  // ==== المرحلة ب: قتل الخادم (انقطاع حقيقي) ====
  const killTree = spawn("taskkill", ["/F", "/T", "/PID", String(server.pid)], {
    stdio: "ignore"
  });
  await new Promise((r) => killTree.on("exit", r));
  await sleep(2000);
  let serverDead = false;
  try {
    await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000) });
  } catch {
    serverDead = true;
  }
  report("server killed", serverDead, `reachable=${!serverDead}`);

  // ==== المرحلة ج: أوف لاين حقيقي ====
  const respLogin = await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 30000 });
  const loginOk = await page.evaluate(
    () =>
      document.title.includes("تسجيل الدخول") &&
      !document.body.innerText.includes("لا يوجد اتصال")
  );
  report(
    "offline /login من كاش SW",
    respLogin.ok() && loginOk,
    `status=${respLogin.status()} contentOk=${loginOk}`
  );

  const respRoot2 = await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 30000 });
  const rootOk = await page.evaluate(() => !document.body.innerText.includes("لا يوجد اتصال"));
  report("offline / من كاش SW", respRoot2.ok() && rootOk, `status=${respRoot2.status()}`);

  const respDash = await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 30000 });
  const dashKind = await page.evaluate(() =>
    document.body.innerText.includes("لا يوجد اتصال") ? "offline.html" : "صفحة بديلة من الكاش"
  );
  report(
    "offline /dashboard (غير مُزار) — يُخدم من الكاش/البديل ولا يظهر خطأ متصفح",
    respDash.ok(),
    `status=${respDash.status()} served=${dashKind}`
  );

  const respUnknown = await page.goto(`${BASE}/no-such-page`, {
    waitUntil: "load",
    timeout: 30000
  });
  const unknownOffline = await page.evaluate(() =>
    document.body.innerText.includes("لا يوجد اتصال")
  );
  report(
    "offline مسار مجهول → offline.html",
    respUnknown.ok() && unknownOffline === true,
    `status=${respUnknown.status()} offlinePage=${unknownOffline}`
  );
} catch (err) {
  failed = true;
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
process.exit(failed || failedCount ? 1 : 0);
