const BASE = process.argv[2] ?? "http://localhost:3000";
const USERS = 100;
const CONCURRENCY = 25;

const SCENARIO = [
  { name: "GET /", method: "GET", path: "/" },
  { name: "GET /login", method: "GET", path: "/login" },
  {
    name: "POST /api/sync/pull (بلا جلسة)",
    method: "POST",
    path: "/api/sync/pull",
    body: JSON.stringify({
      deviceId: "loadtest-device-0000000001",
      businessId: "00000000-0000-0000-0000-000000000000",
      since: null
    })
  },
  {
    name: "POST /api/sync/push (بلا جلسة)",
    method: "POST",
    path: "/api/sync/push",
    body: JSON.stringify({ deviceId: "loadtest-device-0000000001", operations: [] })
  }
];

function pool(items, size, worker) {
  return new Promise((resolve) => {
    const results = [];
    let cursor = 0;
    let done = 0;
    const next = async () => {
      if (cursor >= items.length) return;
      const index = cursor++;
      results[index] = await worker(items[index]);
      done += 1;
      if (done === items.length) resolve(results);
      else void next();
    };
    for (let i = 0; i < Math.min(size, items.length); i += 1) void next();
  });
}

async function measure(request) {
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}${request.path}`, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: request.body,
      redirect: "manual"
    });
    await response.arrayBuffer();
    return { status: response.status, ms: Date.now() - started, error: null };
  } catch (error) {
    return {
      status: 0,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : "فشل"
    };
  }
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

const summary = new Map();
for (const step of SCENARIO) summary.set(step.name, []);

const userRequests = [];
for (let user = 0; user < USERS; user += 1) {
  for (const step of SCENARIO) userRequests.push(step);
}

const started = Date.now();
const outcomes = await pool(userRequests, CONCURRENCY, measure);
const elapsed = Date.now() - started;

outcomes.forEach((outcome, index) => {
  const name = userRequests[index].name;
  summary.get(name).push(outcome);
});

let serverErrors = 0;
let networkErrors = 0;
console.log(`\n=== اختبار تحميل: ${USERS} مستخدم × ${SCENARIO.length} طلب = ${userRequests.length} طلب، تزامن ${CONCURRENCY} ===`);
console.log(`المجموع: ${elapsed}ms\n`);

for (const [name, list] of summary) {
  const latencies = list.map((item) => item.ms).sort((a, b) => a - b);
  const statuses = new Map();
  for (const item of list) {
    statuses.set(item.status, (statuses.get(item.status) ?? 0) + 1);
    if (item.status >= 500) serverErrors += 1;
    if (item.status === 0) networkErrors += 1;
  }
  const avg = Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length);
  console.log(
    `${name}\n  الحالات: ${[...statuses].map(([code, count]) => `${code}×${count}`).join("، ")}` +
      `\n  زمن الاستجابة: متوسط ${avg}ms | p95 ${percentile(latencies, 95)}ms | الأقصى ${latencies[latencies.length - 1]}ms`
  );
}

console.log(`\nأخطاء خادم (5xx): ${serverErrors} | فشل شبكة: ${networkErrors}`);
if (serverErrors > 0 || networkErrors > 0) {
  console.log("النتيجة: فشل");
  process.exit(1);
}
console.log("النتيجة: نجح — صفر أعطال خادم عبر كل الطلبات");
