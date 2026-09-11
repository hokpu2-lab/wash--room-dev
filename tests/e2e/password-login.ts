import type { Page } from "@playwright/test";

export async function submitPasswordLogin(
  page: Page,
  destination: RegExp = /\/app(?:\/|$)/,
) {
  await page.getByLabel("登入帳號").fill("admin");
  await page.getByLabel("密碼").fill("Temporary-Admin-42!");
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL(destination);
}
