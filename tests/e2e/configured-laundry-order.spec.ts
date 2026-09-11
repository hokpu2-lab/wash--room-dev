import { expect, test } from "@playwright/test";

const fakeSupabaseOrigin = "http://127.0.0.1:54390";
const cartId = "40000000-0000-4000-8000-000000000099";

async function getCartToken(request: import("@playwright/test").APIRequestContext) {
  const response = await request.get(`${fakeSupabaseOrigin}/__test/laundry-cart-token/${cartId}`);
  return (await response.json()).token as string;
}

test("送洗人員掃固定車卡 QR 可建立最小待收件洗衣單，重掃不會重複建單", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  const token = await getCartToken(request);
  await page.goto(`/scan/cart#v1.cart.${token}`);
  await expect(page.getByText("目前未登入")).toBeVisible();
  await page.getByRole("button", { name: "確認送單" }).click();
  await expect(page.getByRole("status")).toContainText("送單建立完成");
  await expect(page.getByText(/MAIN-20260808-0001/)).toBeVisible();
  expect(page.url()).toBe("http://127.0.0.1:3101/scan/cart");
  expect(await page.content()).not.toContain(token);

  await page.goto(`/scan/cart?retry=1#v1.cart.${token}`);
  await page.getByRole("button", { name: "確認送單" }).click();
  await expect(page.locator("div[role='alert']").filter({ hasText: "已有尚未結案的洗衣單" })).toBeVisible();
});

test("未登入送洗人員掃待取件洗衣車 QR 可直接完成取件", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor-pickup`);
  const token = await getCartToken(request);

  await page.goto(`/scan/cart#v1.cart.${token}`);
  await expect(page.getByText("目前未登入")).toBeVisible();
  await expect(page.getByText("不需要登入")).toBeVisible();
  await page.getByRole("button", { name: "確認取件" }).click();

  await expect(page).toHaveURL("http://127.0.0.1:3101/scan/pickup");
  await expect(page.getByRole("status")).toContainText("取件完成");
});

test("匿名頁不接受沒有固定車卡格式的 fragment", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
  await page.goto("/scan/cart#v1.cart.not-a-token");
  await expect(page.locator("div[role='alert']").filter({ hasText: "固定車卡 QR 無效" })).toBeVisible();
  await expect(page.getByRole("link", { name: "切換至送洗人員領回" })).toHaveCount(0);
  expect(page.url()).toBe("http://127.0.0.1:3101/scan/cart");
});

test("取件分流遺失 fragment 時可使用同頁暫存的固定車卡憑證", async ({ page }) => {
  const token = `wrq_v1.${"A".repeat(43)}.${"B".repeat(43)}`;
  let pickupBody: Record<string, unknown> | null = null;

  await page.addInitScript((pendingToken) => {
    window.sessionStorage.setItem("wr_pending_cart_token", pendingToken);
  }, token);
  await page.route("**/api/scan/pickup", async (route) => {
    pickupBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "picked-up",
        orderNumber: "MAIN-20260808-0001",
        status: "picked_up",
      }),
    });
  });

  await page.goto("/scan/pickup");
  await expect(page.getByRole("status")).toContainText("取件完成");
  expect(pickupBody).toMatchObject({ qr_token: token });
  expect(await page.evaluate(() => window.sessionStorage.getItem("wr_pending_cart_token"))).toBeNull();
});
