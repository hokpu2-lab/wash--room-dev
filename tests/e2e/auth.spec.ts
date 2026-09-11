import { expect, test } from "@playwright/test";

test("未設定 Supabase 時登入頁會顯示帳密欄位並安全停用登入", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { level: 1, name: "登入洗衣管理系統" }),
  ).toBeVisible();
  await expect(page.getByLabel("登入帳號")).toBeVisible();
  await expect(page.getByLabel("密碼")).toBeVisible();
  await expect(page.getByRole("button", { name: "登入" })).toBeDisabled();
  await expect(page.getByText(/Google/i)).toHaveCount(0);
  await expect(page.getByText("Supabase 尚未完成設定")).toBeVisible();
});
