import { expect, test } from "@playwright/test";

import { submitPasswordLogin } from "./password-login";

const fakeSupabaseOrigin = "http://127.0.0.1:54390";

async function loginAsSupervisor(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
) {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/admin$/);
}

test("洗衣主管可管理分類並發布不可變程序版本", async ({ page, request }) => {
  await loginAsSupervisor(page, request);
  await page.getByRole("link", { name: "管理洗滌分類與程序範本" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "洗滌分類與程序範本" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "消毒品" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "圍兜" })).toBeVisible();

  await page.getByLabel("分類代碼").first().fill("SPECIAL");
  await page.getByLabel("分類名稱").first().fill("特殊布品");
  await page.getByLabel("新增理由").fill("建立特殊布品分類");
  await page.getByRole("button", { name: "新增分類" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存程序設定");
  await expect(page.getByRole("cell", { name: "特殊布品" })).toBeVisible();

  await page.getByRole("tab", { name: /程序範本/ }).click();
  await page.getByLabel("程序名稱").first().fill("消毒標準程序");
  await page.getByLabel("草稿理由").fill("建立消毒標準程序");
  await page.getByRole("button", { name: "建立程序草稿" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存程序設定");

  const template = page.locator("article").filter({ hasText: "DISINFECT" });
  await expect(template.getByText("v1 · 草稿")).toBeVisible();
  await template.getByLabel("發布理由").fill("發布消毒標準程序 v1");
  await template.getByRole("button", { name: "發布 v1" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存程序設定");
  await expect(template.getByText("v1 · 已發布")).toBeVisible();

  await template.getByLabel("版本理由").fill("建立消毒標準程序 v2 草稿");
  await template.getByRole("button", { name: "建立下一版本草稿" }).click();
  await expect(page.getByRole("status")).toContainText("已儲存程序設定");
  await expect(template.getByText("v2 · 草稿")).toBeVisible();
  await template.getByLabel("發布理由").fill("發布消毒標準程序 v2");
  await template.getByRole("button", { name: "發布 v2" }).click();
  await expect(template.getByText("v1 · 已封存")).toBeVisible();
  await expect(template.getByText("v2 · 已發布")).toBeVisible();
});

test("洗衣員沒有分類與程序管理入口且直接網址會被拒絕", async ({
  page,
  request,
}) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/operations$/);
  await expect(
    page.getByRole("link", { name: "管理洗滌分類與程序範本" }),
  ).toHaveCount(0);
  await page.goto("/app/admin/procedures");
  await expect(page).toHaveURL(/\/app\/operations$/);
});
