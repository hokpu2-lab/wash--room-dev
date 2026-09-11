import { expect, test } from "@playwright/test";

test("root 顯示輕量入口，不是健康檢查頁", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "洗衣管理系統" })).toBeVisible();
  await expect(page.getByRole("link", { name: "登入作業台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "系統狀態" })).toHaveCount(0);
});

test("離線紙本流程不含帳號或 QR", async ({ page }) => {
  const response = await page.goto("/offline.html");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "離線紙本流程" })).toBeVisible();
  await expect(page.getByText("wrq_v1.")).toHaveCount(0);
});
