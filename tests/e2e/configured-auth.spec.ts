import { expect, test } from "@playwright/test";

import { submitPasswordLogin } from "./password-login";

const fakeSupabaseOrigin = "http://127.0.0.1:54390";

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function expiredSessionCookie() {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = [
    base64UrlJson({ alg: "HS256", typ: "JWT" }),
    base64UrlJson({
      aud: "authenticated",
      exp: now - 60,
      iat: now - 3660,
      role: "authenticated",
      sub: "10000000-0000-4000-8000-000000000099",
    }),
    "expired-signature",
  ].join(".");

  return `base64-${base64UrlJson({
    access_token: accessToken,
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now - 60,
    user: { id: "10000000-0000-4000-8000-000000000099" },
  })}`;
}

function damagedSessionCookie() {
  return `base64-${base64UrlJson({
    access_token: "damaged-access-token",
    refresh_token: "damaged-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) - 60,
    user: null,
  })}`;
}

test.beforeEach(async ({ request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/boundary`);
});

test("登入帳號會轉為內部 Auth Email 並使用 password grant", async ({
  page,
  request,
}) => {
  await page.goto("/login");

  await page.getByLabel("登入帳號").fill(" ADMIN ");
  await page.getByLabel("密碼").fill("Temporary-Admin-42!");
  const loginButton = page.getByRole("button", { name: "登入" });
  await expect(loginButton).toBeEnabled();
  await loginButton.click();
  await expect(page).toHaveURL(/\/auth\/denied$/);

  const authRequest = await (
    await request.get(`${fakeSupabaseOrigin}/__test/last-auth-request`)
  ).json();
  expect(authRequest).toEqual({
    grant_type: "password",
    email: "admin@auth.wash-room.invalid",
    password_accepted: true,
  });
});

test("proxy 會刷新過期 session 並安全回寫 cookie", async ({ page, context }) => {
  const staleCookie = expiredSessionCookie();
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value: staleCookie,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const response = await page.goto("/status");
  const refreshedCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "sb-127-auth-token",
  );

  expect(refreshedCookie?.value).toBeTruthy();
  expect(refreshedCookie?.value).not.toBe(staleCookie);
  expect(response?.headers()["cache-control"] ?? "").toContain("no-store");
});

test("損壞的 session cookie 不會把公開首頁導向受保護工作區", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value: damagedSessionCookie(),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/");

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "洗衣管理系統" })).toBeVisible();
  await expect(page.getByRole("link", { name: "登入作業台" })).toBeVisible();
});

test("有效 session 從首頁直接進入角色工作台", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await page.goto("/");

  await expect(page).toHaveURL(/\/app\/operations$/);
  await expect(page.getByRole("heading", { level: 1, name: "洗衣員作業台" })).toBeVisible();
});

test("允許名單內的密碼帳號登入後進入洗衣員作業台", async ({
  page,
  request,
}) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");

  await page.getByLabel("登入帳號").fill("admin");
  await page.getByLabel("密碼").fill("Temporary-Admin-42!");
  await page.getByRole("button", { name: "登入" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "洗衣員作業台" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app\/operations$/);
  await expect(page.getByLabel("班別工作指標").getByText("待收件", { exact: true })).toBeVisible();
  await expect(page.getByText("可開始", { exact: true })).toBeVisible();
  await expect(page.getByText("進行中", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /作業控制點/ }).click();
  const operationsMain = page.getByRole("main");
  await expect(operationsMain.getByRole("link", { name: /收單與分類/ })).toBeVisible();
  await expect(operationsMain.getByRole("link", { name: /開始清洗/ })).toBeVisible();

  await page.getByRole("navigation", { name: "主要功能" }).getByRole("link", { name: "洗衣單與批次" }).click();
  await expect(page).toHaveURL(/\/app\/operations\/control-center/);
  await expect(page.getByRole("heading", { name: "目前批次" })).toBeVisible();
  await expect(page.getByText(/伺服器快照|定時更新|即時更新/)).toBeVisible();
});

test("洗衣員可在控制中心確認原因後還原批次上一步", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await page.goto("/app/operations/control-center");

  await page.getByRole("tab", { name: /還原上一步/ }).click();
  await expect(page.getByRole("heading", { name: "還原上一步" })).toBeVisible();
  await page.getByLabel("還原原因").fill("誤掃到 2 號洗衣機，衣物尚未放入");
  await page.getByLabel("我已確認這是最後一個錯誤操作").check();
  await page.getByRole("button", { name: "確認還原上一步" }).click();

  await expect(page).toHaveURL(/status=stage_start_reversed/);
  await expect(page.getByRole("status")).toContainText("已取消誤開始的階段並釋放設備");
  const recorded = await (
    await request.get(`${fakeSupabaseOrigin}/__test/last-operation-reversal`)
  ).json();
  expect(recorded).toMatchObject({
    target_laundry_batch_id: "61000000-0000-4000-8000-000000000099",
    reversal_reason: "誤掃到 2 號洗衣機，衣物尚未放入",
  });
  expect(recorded.change_request_id).toMatch(/^[0-9a-f-]{36}$/);
});

test("首次登入必須更換暫時密碼後才能進入工作區", async ({
  page,
  request,
}) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/password-change-required`);
  await page.goto("/login");
  await page.getByLabel("登入帳號").fill("admin");
  await page.getByLabel("密碼").fill("Temporary-Admin-42!");
  await page.getByRole("button", { name: "登入" }).click();

  await expect(page).toHaveURL(/\/account\/change-password$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "設定新的登入密碼" }),
  ).toBeVisible();

  await page.goto("/app/operations");
  await expect(page).toHaveURL(/\/account\/change-password$/);

  await page.getByLabel("目前的暫時密碼").fill("Temporary-Admin-42!");
  await page.getByLabel("新密碼", { exact: true }).fill("New-Admin-Password-84!");
  await page.getByLabel("再次輸入新密碼").fill("New-Admin-Password-84!");
  await page.getByRole("button", { name: "儲存新密碼並進入系統" }).click();

  await expect(page).toHaveURL(/\/app\/operations$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "洗衣員作業台" }),
  ).toBeVisible();
});

test("密碼登入寫入 session cookie 時禁止共享快取", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  const loginActionResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/login" &&
      response.request().method() === "POST",
  );

  await submitPasswordLogin(page);

  const cacheControl = (await loginActionResponse).headers()["cache-control"] ?? "";
  expect(cacheControl).toContain("private");
  expect(cacheControl).toContain("no-store");
});

test("未核准的密碼帳號只顯示通用拒絕訊息", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/denied`);
  await page.goto("/login");

  await submitPasswordLogin(page, /\/auth\/denied$/);

  await expect(page).toHaveURL(/\/auth\/denied$/);
  await expect(page.getByRole("heading", { name: "此帳號目前無法使用系統" })).toBeVisible();
  await expect(page.getByText("allowed.worker@example.com")).toHaveCount(0);
  await expect(page.getByText(/允許名單|停用|membership/i)).toHaveCount(0);
});

test("權限被停用後重新進入頁面會立即拒絕", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/operations$/);

  await request.post(`${fakeSupabaseOrigin}/__test/mode/denied`);
  await page.reload();

  await expect(page).toHaveURL(/\/auth\/denied$/);
  await expect(page.getByText("此帳號目前無法使用系統")).toBeVisible();
});

test("洗衣員可從作業台登出並清除本機 session", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await page.getByRole("button", { name: "登出" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "登入洗衣管理系統" }),
  ).toBeVisible();

  await page.goto("/app/operations");
  await expect(page).toHaveURL(/\/login$/);
});

test("洗衣主管登入後進入主管工作台", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  const snapshotRpcCalls: string[] = [];
  page.on("request", (httpRequest) => {
    if (httpRequest.url().includes("get_workspace_snapshot")) {
      snapshotRpcCalls.push(httpRequest.url());
    }
  });
  await page.goto("/login");
  await submitPasswordLogin(page);

  await expect(page).toHaveURL(/\/app\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "洗衣主管工作台" })).toBeVisible();
  await page.goto("/app/admin/accounts");
  await expect(page.getByRole("heading", { level: 1, name: "帳號與權限管理" })).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "existing.worker" })).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(/\/app\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "洗衣主管工作台" })).toBeVisible();
});

test("洗衣主管工作台提供正式營運導覽與可操作的功能搜尋", async ({
  page,
  request,
}) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  const snapshotRpcCalls: string[] = [];
  page.on("request", (httpRequest) => {
    if (httpRequest.url().includes("get_workspace_snapshot")) {
      snapshotRpcCalls.push(httpRequest.url());
    }
  });
  await page.goto("/login");
  await submitPasswordLogin(page);

  const navigation = page.getByRole("navigation", { name: "主要功能" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "營運總覽" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "洗衣單與批次" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "設備狀態" })).toBeVisible();

  const search = page.getByPlaceholder("搜尋洗衣單、機構、車號或批次");
  await search.fill("設備");
  await expect(
    page.locator('[aria-label="搜尋結果"]').getByRole("link", {
      name: /洗衣設備與固定 QR/,
    }),
  ).toBeVisible();

  const workspaceTabs = page.getByRole("tablist", { name: "洗衣主管工作台分類" });
  const controlsTab = workspaceTabs.getByRole("tab", { name: /快速控制/ });
  await expect(controlsTab).toHaveAttribute("aria-selected", "true");
  await controlsTab.press("Home");
  await expect(workspaceTabs.getByRole("tab", { name: /即時營運/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page).toHaveURL(/#tab=live$/);
  await expect(page.getByText("待收件", { exact: true })).toBeVisible();
  await expect(page.getByText("處理中", { exact: true })).toBeVisible();
  await expect(page.getByLabel("戰情室核心指標").getByText("待取件", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "營運戰情室" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "洗衣單流程" })).toHaveCount(0);
  await expect(
    page.getByLabel(/資料狀態：/).getByText(/即時連線|定時同步|伺服器快照/),
  ).toBeVisible();
  await expect.poll(() => snapshotRpcCalls.length).toBeGreaterThan(0);

  await navigation.getByRole("link", { name: "洗衣單與批次" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.locator("#dashboard-title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "洗衣單清單" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "目前洗滌批次" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "營運戰情室" })).toHaveCount(0);
});

test("主管可在右上切換四種工作台風格並保留選擇", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  const switcher = page.getByLabel("切換介面風格");
  const html = page.locator("html");
  await expect(switcher).toHaveValue("MX");
  await expect(html).toHaveAttribute("data-workspace-style", "MX");

  for (const style of ["AP", "GS", "MB", "SH", "MX"]) {
    await switcher.selectOption(style);
    await expect(switcher).toHaveValue(style);
    await expect(html).toHaveAttribute("data-workspace-style", style);
  }

  await switcher.selectOption("MB");
  await page.reload();
  await expect(page.getByLabel("切換介面風格")).toHaveValue("MB");
  await expect(html).toHaveAttribute("data-workspace-style", "MB");
});

test("待取件洗衣單只能由送洗人員掃描洗衣車固定 QR 結案", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor-pickup`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await page.goto("/app/dashboard");
  await expect(page.locator("#dashboard-title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "洗衣單清單" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "目前洗滌批次" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "營運戰情室" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "洗衣單流程" })).toBeVisible();
  await page.getByRole("button", { name: "前往目前控制點" }).click();
  const washingDialog = page.getByRole("dialog", { name: "開始清洗" });
  await expect(washingDialog.getByText("LAUNDRY WASHING")).toBeVisible();
  await washingDialog.getByRole("button", { name: "關閉" }).click();
  const flowRegion = page.getByRole("region", { name: "洗衣單流程" });
  const processMap = flowRegion.getByRole("group", { name: "LIVE PROCESS MAP" });
  await expect(flowRegion.getByText("HOK CARE · LAUNDRY JOURNEY")).toBeVisible();
  await expect(processMap.getByText("LIVE PROCESS MAP")).toBeVisible();
  await expect(flowRegion.getByLabel("流程狀態圖例")).toContainText("即時狀態");
  await expect(flowRegion.getByLabel("流程狀態圖例")).toContainText("已完成");
  await expect(flowRegion.getByLabel("流程狀態圖例")).toContainText("尚未完成");
  const phaseRail = flowRegion.getByRole("navigation", { name: "洗衣旅程三大階段" });
  await expect(phaseRail.getByRole("button", { name: "查看照護交接：已完成" })).toBeVisible();
  await expect(phaseRail.getByRole("button", { name: "查看專業洗滌：已完成" })).toBeVisible();
  await expect(phaseRail.getByRole("button", { name: "查看安心送回：即時狀態" })).toBeVisible();
  await expect(flowRegion.locator("canvas")).toHaveCount(1);
  await expect(flowRegion.getByText("完整節點與實際耗時")).toHaveCount(0);
  const flowImages = flowRegion.locator('img[src*="laundry-flow"]');
  await expect(flowImages).toHaveCount(1);
  await expect.poll(() => flowImages.evaluateAll((images) => images.every((image) => (
    image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
  )))).toBe(true);
  const flowControls = page.getByRole("group", { name: "流程動畫控制" });
  await expect(flowControls.getByRole("button", { name: "暫停動畫" })).toHaveAttribute("aria-pressed", "true");
  await flowControls.getByRole("button", { name: "暫停動畫" }).click();
  await expect(flowControls.getByRole("button", { name: "播放動畫" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("已選流程節點")).toContainText("待取件");
  await phaseRail.getByRole("button", { name: "查看照護交接：已完成" }).click();
  await flowControls.getByRole("button", { name: "查看上一個流程節點" }).click();
  await expect(page.getByLabel("已選流程節點")).toContainText("待收件");
  await expect(page.getByLabel("已選流程節點")).toContainText("實際耗時 30 分鐘");
  await expect(processMap).toContainText("實際耗時 30 分鐘");
  await phaseRail.getByRole("button", { name: "查看專業洗滌：已完成" }).click();
  await expect(page.getByLabel("已選流程節點")).toContainText("清洗中");
  await expect(page.getByLabel("已選流程節點")).toContainText("標準 45 分鐘");
  await phaseRail.getByRole("button", { name: "查看安心送回：即時狀態" }).click();
  await expect(page.getByLabel("已選流程節點")).toContainText("待取件");
  await flowControls.getByRole("button", { name: "查看下一個流程節點" }).click();
  await expect(page.getByLabel("已選流程節點")).toContainText("已取件");
  await expect(flowRegion.locator("canvas")).toHaveCount(1);
  await expect(page.locator('a[href^="/scan/pickup"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /MAIN-20260808-0001/ })).toHaveCount(0);
});

test("主管可依日期與關鍵字查詢已取件洗衣單", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor-history`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await page.goto("/app/history");
  await expect(page.getByRole("heading", { level: 1, name: "已取件洗衣單" })).toBeVisible();
  await expect(page.getByLabel("已取件洗衣單查詢條件")).toBeVisible();
  await expect(page.getByTestId("history-results")).toContainText("MAIN-20260818-0007");
  await expect(page.getByTestId("history-results")).toContainText("已取件");

  await page.getByLabel("搜尋單號、機構或洗衣車").fill("0007");
  await page.getByRole("button", { name: "查詢歷史洗衣單" }).click();
  await expect(page).toHaveURL(/\/app\/history\?.*q=0007/);
  await expect(page.getByTestId("history-results")).toContainText("MAIN-20260818-0007");

  await page.getByRole("button", { name: "查看 MAIN-20260818-0007 整體歷程" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "洗衣單整體歷程" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("建立洗衣單");
  await expect(page.getByRole("dialog")).toContainText("完成取件");
  await expect(page.getByRole("dialog")).toContainText("B-001 · 汙衣");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "洗衣單流程" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("group", { name: "LIVE PROCESS MAP" }).getByText("LIVE PROCESS MAP")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("完整節點與實際耗時")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByLabel("已選流程節點")).toContainText("已取件");
  const historyPhaseRail = page.getByRole("dialog").getByRole("navigation", { name: "洗衣旅程三大階段" });
  await expect(historyPhaseRail.getByRole("button", { name: "查看照護交接：已完成" })).toBeVisible();
  await expect(historyPhaseRail.getByRole("button", { name: "查看專業洗滌：已完成" })).toBeVisible();
  await expect(historyPhaseRail.getByRole("button", { name: "查看安心送回：已完成" })).toBeVisible();
  await historyPhaseRail.getByRole("button", { name: "查看專業洗滌：已完成" }).click();
  await expect(page.getByRole("dialog").getByLabel("已選流程節點")).toContainText("實際耗時 1 小時");
  const historyFlowControls = page.getByRole("dialog").getByRole("group", { name: "流程動畫控制" });
  await expect(historyFlowControls.getByRole("button", { name: "查看上一個流程節點" })).toBeEnabled();
  await historyFlowControls.getByRole("button", { name: "查看上一個流程節點" }).click();
  await historyFlowControls.getByRole("button", { name: "查看上一個流程節點" }).click();
  await expect(page.getByRole("dialog").getByLabel("已選流程節點")).toContainText("實際耗時 45 分鐘");
  await historyPhaseRail.getByRole("button", { name: "查看安心送回：已完成" }).click();
  await historyFlowControls.getByRole("button", { name: "查看上一個流程節點" }).click();
  await expect(page.getByRole("dialog").getByLabel("已選流程節點")).toContainText("待取件");
  await page.getByRole("button", { name: "關閉" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("主管首頁不會對整份選單發出無意圖 RSC prefetch", async ({
  page,
  request,
}) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  const prefetchedPaths = new Set<string>();
  page.on("request", (httpRequest) => {
    const headers = httpRequest.headers();
    if (headers["next-router-prefetch"] !== "1" && !httpRequest.url().includes("_rsc=")) {
      return;
    }
    const path = new URL(httpRequest.url()).pathname;
    if (path.startsWith("/app/") && path !== "/app/admin") {
      prefetchedPaths.add(path);
    }
  });

  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "洗衣主管工作台" })).toBeVisible();
  await page.waitForTimeout(2000);

  expect([...prefetchedPaths]).toEqual([]);
});

test("密碼登入不重複讀取中繼入口的授權狀態", async ({
  page,
  request,
}) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await expect(page).toHaveURL(/\/app\/admin$/);
  const counts = await (
    await request.get(`${fakeSupabaseOrigin}/__test/request-counts`)
  ).json();
  expect(counts["GET /auth/v1/user"] ?? 0).toBeLessThanOrEqual(2);
  expect(
    counts["POST /rest/v1/rpc/current_account_security_state"] ?? 0,
  ).toBeLessThanOrEqual(2);
});

test("洗衣主管可查看預設作業據點與機構固定配對警語", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/organization-supervisor`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/admin/);
  await expect(page.getByLabel("切換作業範圍")).toBeVisible();
  await expect(page.getByLabel("切換作業範圍")).toHaveValue("");
  await page.getByLabel("切換作業範圍").selectOption({ label: "本館" });
  await page.getByRole("link", { name: "管理作業據點與送洗機構" }).click();

  await expect(page).toHaveURL(/\/app\/admin\/organizations/);
  await expect(
    page.getByRole("heading", { level: 1, name: "作業據點與送洗機構" }),
  ).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "MAIN本館" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "CORP法人" })).toBeVisible();
  await expect(
    page.getByText("配對變更只影響之後建立的洗衣單，不會回寫既有單據。", {
      exact: true,
    }),
  ).toBeVisible();
});

test("單一據點洗衣主管只能在組織主檔看見授權據點", async ({
  page,
  request,
}) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await page.getByRole("link", { name: "管理作業據點與送洗機構" }).click();

  const siteList = page
    .getByRole("heading", { level: 2, name: "可管理作業據點" })
    .locator("..")
    .getByRole("list");
  await expect(siteList.getByRole("listitem")).toHaveCount(1);
  await expect(siteList).not.toContainText("CORP");
  await page.getByRole("tab", { name: /新增機構/ }).click();
  await expect(page.getByLabel("新機構固定配對").getByRole("option")).toHaveCount(1);
  await expect(page.getByLabel("新機構固定配對")).toHaveValue("MAIN");
});

test("洗衣主管可新增送洗機構並傳遞理由與冪等鍵", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/organization-supervisor`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/admin/);
  await page.getByRole("link", { name: "管理作業據點與送洗機構" }).click();

  await page.getByRole("tab", { name: /新增機構/ }).click();
  await page.getByLabel("新機構代碼").fill(" care-b ");
  await page.getByLabel("新機構名稱").fill(" 照護機構 B ");
  await page.getByLabel("新機構固定配對").selectOption("CORP");
  await page.getByLabel("新機構異動理由").fill("新增法人送洗機構");
  await page.getByRole("button", { name: "新增送洗機構" }).click();

  await expect(page.getByRole("status")).toContainText("已儲存送洗機構 CARE-B");
  await page.getByRole("tab", { name: /機構清單/ }).click();
  await expect(
    page.getByRole("row", { name: /CARE-B.*照護機構 B.*CORP.*法人.*啟用/ }),
  ).toBeVisible();
  const recordedChange = await (
    await request.get(`${fakeSupabaseOrigin}/__test/last-institution-change`)
  ).json();
  expect(recordedChange).toMatchObject({
    institution_code: "CARE-B",
    institution_name: "照護機構 B",
    target_site_code: "CORP",
    institution_active: true,
    change_reason: "新增法人送洗機構",
  });
  expect(recordedChange.change_request_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("洗衣主管可修改固定配對並停用送洗機構", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/organization-supervisor`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/admin/);
  await page.getByRole("link", { name: "管理作業據點與送洗機構" }).click();

  await page.getByRole("tab", { name: /修改機構/ }).click();
  const editForm = page.getByRole("form", { name: "修改 CARE-A" });
  await editForm.getByLabel("機構名稱").fill("照護機構 A（停用）");
  await editForm.getByLabel("固定配對").selectOption("CORP");
  await editForm.getByLabel("啟用").uncheck();
  await editForm.getByLabel("異動理由").fill("機構停止送洗並改由法人接管");
  await editForm.getByRole("button", { name: "儲存 CARE-A" }).click();

  await expect(page.getByRole("status")).toContainText("已儲存送洗機構 CARE-A");
  await page.getByRole("tab", { name: /機構清單/ }).click();
  await expect(
    page.getByRole("row", { name: /CARE-A.*照護機構 A（停用）.*CORP.*法人.*停用/ }),
  ).toBeVisible();
  const recordedChange = await (
    await request.get(`${fakeSupabaseOrigin}/__test/last-institution-change`)
  ).json();
  expect(recordedChange).toMatchObject({
    institution_code: "CARE-A",
    institution_name: "照護機構 A（停用）",
    target_site_code: "CORP",
    institution_active: false,
    change_reason: "機構停止送洗並改由法人接管",
  });
});

test("洗衣員沒有組織主檔入口且直接網址會被拒絕", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await expect(page).toHaveURL(/\/app\/operations$/);
  await expect(
    page.getByRole("link", { name: "管理作業據點與送洗機構" }),
  ).toHaveCount(0);

  await page.goto("/app/admin/organizations");

  await expect(page).toHaveURL(/\/app\/operations/);
  await expect(
    page.getByRole("heading", { level: 1, name: "作業據點與送洗機構" }),
  ).toHaveCount(0);
});

test("送洗機構主管登入後進入機構工作台", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/institution`);
  await page.goto("/login");

  await submitPasswordLogin(page);

  await expect(page).toHaveURL(/\/app\/institution$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "送洗機構主管工作台" }),
  ).toBeVisible();
  await expect(page.getByText("未結案洗衣單", { exact: true })).toBeVisible();
  await expect(page.getByText("待取件", { exact: true })).toBeVisible();
  await expect(page.getByText("整體預估進度", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /查看營運儀表板/ })).toBeVisible();
});

test("多角色使用者以正式角色名稱選擇工作入口", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/multi`);
  await page.goto("/login");

  await submitPasswordLogin(page);

  await expect(page).toHaveURL(/\/app\/admin/);
  await expect(page.getByRole("heading", { name: "洗衣主管工作台" })).toBeVisible();
  await expect(page.getByLabel("切換作業範圍")).toHaveCount(0);
});
