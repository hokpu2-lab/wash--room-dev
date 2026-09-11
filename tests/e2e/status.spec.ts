import { expect, test } from "@playwright/test";

import { serviceRoleSecretSentinel } from "../support/e2e-constants";

test("訪客可以確認系統已啟動且 Supabase 尚待設定", async ({ page }) => {
  await page.goto("/status");

  await expect(
    page.getByRole("heading", { level: 1, name: "系統狀態" }),
  ).toBeVisible();
  await expect(page.getByText("應用程式已啟動")).toBeVisible();
  await expect(page.getByText("Supabase 尚未設定")).toBeVisible();

  const renderedHtml = await page.content();
  expect(renderedHtml).not.toContain(serviceRoleSecretSentinel);
  expect(renderedHtml).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
});
