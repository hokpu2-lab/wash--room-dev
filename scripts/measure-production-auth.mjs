import { chromium } from "@playwright/test";

const origin = process.env.SMOKE_BASE_URL ?? "https://wash-room.vercel.app";
const loginName = process.env.PRODUCTION_LOGIN_NAME;
const password = process.env.PRODUCTION_LOGIN_PASSWORD;
const samples = Number(process.env.SMOKE_SAMPLES ?? 5);

if (!loginName || !password) {
  console.error("Set PRODUCTION_LOGIN_NAME and PRODUCTION_LOGIN_PASSWORD.");
  process.exit(1);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor((sorted.length - 1) * p)]);
}

const loginTimes = [];
const navTimes = [];
const browser = await chromium.launch();

for (let index = 0; index < samples; index += 1) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("登入帳號").fill(loginName);
  await page.getByLabel("密碼").fill(password);
  const loginStarted = Date.now();
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 20_000 });
  loginTimes.push(Date.now() - loginStarted);

  const nav = page.getByRole("navigation", { name: "主要功能" });
  const navLink = nav.getByRole("link").filter({ hasNotText: "營運總覽" }).first();
  if (await navLink.count()) {
    const navStarted = Date.now();
    await navLink.click();
    await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 20_000 });
    navTimes.push(Date.now() - navStarted);
  }
  await context.close();
}

await browser.close();
console.log(
  JSON.stringify(
    {
      origin,
      samples,
      loginMs: {
        p50: percentile(loginTimes, 0.5),
        p95: percentile(loginTimes, 0.95),
        samples: loginTimes,
      },
      inAppNavMs: navTimes.length
        ? {
            p50: percentile(navTimes, 0.5),
            p95: percentile(navTimes, 0.95),
            samples: navTimes,
          }
        : null,
    },
    null,
    2,
  ),
);
