import { expect, test, type Page } from "@playwright/test";

import { submitPasswordLogin } from "./password-login";

const fakeSupabaseOrigin = "http://127.0.0.1:54390";

async function expectModuleTabs(
  page: Page,
  route: string,
  label: string,
  tabs: string[],
  selected: string,
) {
  await page.goto(route);
  const tablist = page.getByRole("tablist", { name: label });
  await expect(tablist).toBeVisible();
  await expect(tablist.getByRole("tab")).toHaveCount(tabs.length);
  for (const tab of tabs) {
    await expect(tablist.getByRole("tab", { name: tab, exact: true })).toBeVisible();
  }
  await expect(tablist.getByRole("tab", { name: selected, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

test("主管各管理模組依工作意圖分類為標籤頁", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await expectModuleTabs(
    page,
    "/app/admin",
    "洗衣主管工作台分類",
    ["即時營運", "快速控制"],
    "快速控制",
  );
  await expectModuleTabs(
    page,
    "/app/admin/accounts",
    "帳號管理功能",
    ["帳號清單", "新增帳號", "編輯帳號", "密碼管理", "刪除帳號", "批次權限"],
    "帳號清單",
  );
  await expectModuleTabs(
    page,
    "/app/admin/organizations",
    "送洗機構管理功能",
    ["新增機構", "機構清單", "修改機構"],
    "機構清單",
  );
  await expectModuleTabs(
    page,
    "/app/admin/laundry-carts",
    "洗衣車管理功能",
    ["登錄洗衣車", "洗衣車清單"],
    "洗衣車清單",
  );
  await expectModuleTabs(
    page,
    "/app/admin/laundry-equipment",
    "洗衣設備管理功能",
    ["新增設備", "修改設備", "刪除誤建", "設備清單"],
    "設備清單",
  );
  await expectModuleTabs(
    page,
    "/app/admin/procedures",
    "分類與程序管理功能",
    ["洗滌分類", "程序範本"],
    "洗滌分類",
  );
  await expectModuleTabs(
    page,
    "/app/admin/notifications",
    "通知設定功能",
    ["通知規則", "外部目的地"],
    "通知規則",
  );
  await expectModuleTabs(
    page,
    "/app/admin/bi",
    "分析與 BI 功能",
    ["模型庫", "我的分析", "報表與匯出", "摘要與建議", "舊單匯入"],
    "模型庫",
  );
  await expect(page.getByRole("heading", { name: "報表版面範例" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "營運戰情總覽" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "流程健康度" })).toBeVisible();
  await expect(page.getByRole("button", { name: "套用這個模型" }).first()).toBeVisible();
  const mainNavigation = page.getByRole("navigation", { name: "主要功能" });
  await expect(mainNavigation.getByRole("link", { name: "報表與匯出", exact: true })).toHaveCount(0);
  await expect(mainNavigation.getByRole("link", { name: "分析摘要與建議", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "報表與匯出" }).click();
  await expect(page.getByRole("heading", { name: "報表與匯出" })).toBeVisible();
  await expect(page.getByRole("link", { name: /下載 CSV/ })).toBeVisible();
  await page.getByRole("tab", { name: "摘要與建議" }).click();
  await expect(page.getByRole("heading", { name: "分析摘要與建議" })).toBeVisible();
  await expect(page.getByText(/目前未啟用外部 AI|已偵測到可選 AI 設定/)).toBeVisible();
  await page.goto("/app/admin/exports");
  await expect(page).toHaveURL(/\/app\/admin\/bi#tab=exports$/);
  await page.goto("/app/admin/ai");
  await expect(page).toHaveURL(/\/app\/admin\/bi#tab=insights$/);
  await page.goto("/app/admin/imports");
  await expect(page).toHaveURL(/\/app\/admin\/bi#tab=imports$/);
  await page.getByRole("tab", { name: "舊單匯入" }).click();
  await expect(page.getByRole("heading", { name: "舊單匯入" })).toBeVisible();
});

test("洗衣員作業模組保留流程型控制並支援頁籤深連結", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await expectModuleTabs(
    page,
    "/app/operations",
    "洗衣員工作台分類",
    ["目前作業", "作業控制點"],
    "目前作業",
  );
  await page.goto("/app/operations/control-center#tab=reverse");
  const controlTabs = page.getByRole("tablist", { name: "批次控制功能" });
  await expect(controlTabs.getByRole("tab")).toHaveCount(4);
  await expect(controlTabs.getByRole("tab", { name: "還原上一步" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: "還原上一步" })).toBeVisible();
});
