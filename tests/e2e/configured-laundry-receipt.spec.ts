import { expect, test } from "@playwright/test";

import { submitPasswordLogin } from "./password-login";

const fakeSupabaseOrigin = "http://127.0.0.1:54390";
const cartId = "40000000-0000-4000-8000-000000000099";

test("洗衣員掃同一車卡並選分類後建立初始批次", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  const token = (await (await request.get(`${fakeSupabaseOrigin}/__test/laundry-cart-token/${cartId}`)).json()).token as string;
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/operations$/);
  await page.getByRole("tab", { name: "作業控制點" }).click();
  await page.getByRole("main").getByRole("link", { name: /收單與分類/ }).click();
  await page.goto(`/app/operations/receive#v1.cart.${token}`);
  await expect(page.getByText("已掃描車卡")).toBeVisible();
  await page.getByLabel(/汙衣（SOILED）/).check();
  await page.getByRole("button", { name: "確認收單並建立批次" }).click();
  await expect(page.getByRole("status")).toContainText("已建立 1 個初始批次");
  expect(page.url()).toBe("http://127.0.0.1:3101/app/operations/receive");
  expect(await page.content()).not.toContain(token);
});

test("洗衣員直接進入收單頁但沒有車卡 QR 時不會建立批次", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/operations$/);
  await page.goto("/app/operations/receive");
  await expect(page.locator("[role='alert']").filter({ hasText: "固定車卡 QR 無效" })).toBeVisible();
});
