const baseUrl = process.env.SMOKE_BASE_URL;
const count = Math.min(Number(process.env.SMOKE_REQUESTS ?? 100), 300);
if (!baseUrl) { console.error("SMOKE_BASE_URL is required"); process.exit(2); }
const started = performance.now();
const responses = await Promise.all(Array.from({ length: count }, () => fetch(new URL("/status", baseUrl), { redirect: "manual" })));
const failures = responses.filter((response) => !response.ok).length;
const elapsed = Math.round(performance.now() - started);
console.log(JSON.stringify({ requests: count, failures, elapsedMs: elapsed, requestsPerSecond: Math.round(count / Math.max(elapsed / 1000, 0.001)) }));
if (failures > 0) process.exit(1);
