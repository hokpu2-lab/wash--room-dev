const baseUrl = process.env.SMOKE_BASE_URL;
if (!baseUrl) {
  console.error("SMOKE_BASE_URL is required");
  process.exit(2);
}
const response = await fetch(new URL("/status", baseUrl), { redirect: "manual" });
if (!response.ok) {
  console.error(`status failed: ${response.status}`);
  process.exit(1);
}
const body = await response.text();
if (!body.toLowerCase().includes("running") && !body.includes("應用程式已啟動")) {
  console.error("status payload did not contain running marker");
  process.exit(1);
}
console.log(`smoke ok ${baseUrl}/status`);
