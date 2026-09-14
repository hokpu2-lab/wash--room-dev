import { expect, test } from "@playwright/test";

import { submitPasswordLogin } from "./password-login";
import jsQR from "jsqr";
import { PNG } from "pngjs";

const fakeSupabaseOrigin = "http://127.0.0.1:54390";

async function loginAsSupervisor(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  mode: "supervisor" | "organization-supervisor" = "supervisor",
) {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/${mode}`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await expect(page).toHaveURL(/\/app\/admin/);
}

test("單一據點洗衣主管可進入洗衣車清單且看不到跨據點資產", async ({
  page,
  request,
}) => {
  await loginAsSupervisor(page, request);

  await page.getByRole("link", { name: "管理洗衣車與固定 QR" }).click();

  await expect(page).toHaveURL(/\/app\/admin\/laundry-carts/);
  await expect(
    page.getByRole("heading", { level: 1, name: "洗衣車與固定 QR" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /CART-MAIN-01.*CARE-A.*照護機構 A.*本館.*啟用/ }),
  ).toBeVisible();
  await expect(page.getByText("CART-CORP-01", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /登錄洗衣車/ }).click();
  await expect(page.getByLabel("送洗機構").getByRole("option")).toHaveCount(1);
  await expect(page.getByLabel("送洗機構")).toHaveValue("CARE-A");
});

test("洗衣主管可登錄洗衣車並傳遞理由與冪等鍵", async ({ page, request }) => {
  const cartNumber = `CART-${"X".repeat(35)}`;
  await loginAsSupervisor(page, request, "organization-supervisor");
  await page.getByRole("link", { name: "管理洗衣車與固定 QR" }).click();

  await page.getByRole("tab", { name: /登錄洗衣車/ }).click();
  await page.getByLabel("洗衣車編號").fill(cartNumber.toLowerCase());
  await page.getByLabel("送洗機構").selectOption("CARE-CORP");
  await page.getByLabel("登錄理由").fill("新增法人洗衣車");
  await page.getByRole("button", { name: "登錄洗衣車" }).click();

  await expect(page.getByRole("status")).toContainText(`已登錄洗衣車 ${cartNumber}`);
  await page.getByRole("tab", { name: /洗衣車清單/ }).click();
  await expect(
    page.getByRole("row", {
      name: new RegExp(`${cartNumber}.*CARE-CORP.*法人機構.*法人.*啟用`),
    }),
  ).toBeVisible();

  const observationResponse = await request.get(
    `${fakeSupabaseOrigin}/__test/last-laundry-cart-change`,
  );
  expect(observationResponse.status()).toBe(200);
  const recordedChange = await observationResponse.json();
  expect(recordedChange).toMatchObject({
    operation: "register",
    requested_cart_number: cartNumber,
    target_institution_code: "CARE-CORP",
    change_reason: "新增法人洗衣車",
  });
  expect(recordedChange.change_request_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(JSON.stringify(recordedChange)).not.toMatch(/wrq_v1|qr_token/i);

  await page.getByRole("link", { name: `查看 ${cartNumber} 固定 QR` }).click();
  const assetPath = await page
    .getByRole("img", { name: `${cartNumber} 固定 QR` })
    .getAttribute("src");
  const svg = await (await page.request.get(assetPath!)).text();
  await page.setContent(svg);
  const labelMargins = await page.locator("svg").evaluate((svgElement) => {
    const svgNode = svgElement as SVGSVGElement;
    const label = svgNode.querySelector("text");
    if (!label) return null;
    const bounds = label.getBBox();
    const viewBox = svgNode.viewBox.baseVal;
    return {
      left: bounds.x - viewBox.x,
      right: viewBox.x + viewBox.width - (bounds.x + bounds.width),
    };
  });
  expect(labelMargins).not.toBeNull();
  expect(labelMargins!.left).toBeGreaterThan(1);
  expect(labelMargins!.right).toBeGreaterThan(1);
});

test("洗衣主管可填寫理由啟停洗衣車且不會輪替固定 QR", async ({
  page,
  request,
}) => {
  await loginAsSupervisor(page, request);
  await page.getByRole("link", { name: "管理洗衣車與固定 QR" }).click();

  const assetPath =
    "/app/admin/laundry-carts/40000000-0000-4000-8000-000000000099/qr-asset/svg";
  const originalSvg = await (await page.request.get(assetPath)).text();

  await page.getByLabel("CART-MAIN-01 啟停理由").fill("車體維修暫停使用");
  await page.getByRole("button", { name: "停用 CART-MAIN-01" }).click();

  await expect(page.getByRole("status")).toContainText("已停用洗衣車 CART-MAIN-01");
  await expect(
    page.getByRole("row", { name: /CART-MAIN-01.*CARE-A.*照護機構 A.*本館.*停用/ }),
  ).toBeVisible();
  const recordedChange = await (
    await request.get(`${fakeSupabaseOrigin}/__test/last-laundry-cart-change`)
  ).json();
  expect(recordedChange).toMatchObject({
    operation: "set-active",
    target_laundry_cart_id: "40000000-0000-4000-8000-000000000099",
    target_active: false,
    change_reason: "車體維修暫停使用",
  });
  expect(recordedChange.change_request_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

  expect(await (await page.request.get(assetPath)).text()).toBe(originalSvg);
  await page.getByLabel("CART-MAIN-01 啟停理由").fill("維修完成重新啟用");
  await page.getByRole("button", { name: "啟用 CART-MAIN-01" }).click();
  await expect(page.getByRole("status")).toContainText("已啟用洗衣車 CART-MAIN-01");
  expect(await (await page.request.get(assetPath)).text()).toBe(originalSvg);
});

test("遭竄改的洗衣車啟停狀態會被拒絕且不改變資料", async ({
  page,
  request,
}) => {
  await loginAsSupervisor(page, request);
  await page.getByRole("link", { name: "管理洗衣車與固定 QR" }).click();

  await page.locator('input[name="target_active"]').evaluate((input) => {
    input.setAttribute("value", "disable");
  });
  await page.getByLabel("CART-MAIN-01 啟停理由").fill("竄改的啟停請求");
  await page.getByRole("button", { name: "停用 CART-MAIN-01" }).click();

  await expect(page).toHaveURL(/cart=invalid/);
  await expect(
    page.getByRole("row", { name: /CART-MAIN-01.*CARE-A.*照護機構 A.*本館.*啟用/ }),
  ).toBeVisible();
});

test("洗衣主管查看的固定 QR 跨重整一致且禁止快取與權杖洩漏", async ({
  page,
  request,
}) => {
  await loginAsSupervisor(page, request);
  await page.getByRole("link", { name: "管理洗衣車與固定 QR" }).click();
  await page.getByRole("link", { name: "查看 CART-MAIN-01 固定 QR" }).click();

  await expect(page).toHaveURL(
    /\/app\/admin\/laundry-carts\/40000000-0000-4000-8000-000000000099\/qr$/,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "CART-MAIN-01 固定 QR" }),
  ).toBeVisible();
  await expect(page.getByText("CARE-A · 照護機構 A", { exact: true })).toBeVisible();
  await expect(page.getByText("MAIN · 本館", { exact: true })).toBeVisible();

  const image = page.getByRole("img", { name: "CART-MAIN-01 固定 QR" });
  await expect(image).toBeVisible();
  const assetPath = await image.getAttribute("src");
  expect(assetPath).toBe(
    "/app/admin/laundry-carts/40000000-0000-4000-8000-000000000099/qr-asset/svg",
  );
  expect(page.url()).not.toMatch(/wrq_v1|qr_token/i);
  const initialContentExcludingTargetUrl = (await page.content()).replace(
    /<p[^>]*class="[^"]*qrTargetUrl[^"]*"[\s\S]*?<\/p>/i,
    "",
  );
  expect(initialContentExcludingTargetUrl).not.toMatch(/wrq_v1|qr_token/i);

  const firstAsset = await page.request.get(assetPath!);
  expect(firstAsset.status()).toBe(200);
  expect(firstAsset.headers()["content-type"]).toContain("image/svg+xml");
  expect(firstAsset.headers()["cache-control"]).toContain("private");
  expect(firstAsset.headers()["cache-control"]).toContain("no-store");
  expect(firstAsset.headers()["cdn-cache-control"]).toBe("no-store");
  expect(firstAsset.headers()["vercel-cdn-cache-control"]).toBe("no-store");
  expect(firstAsset.headers()["pragma"]).toBe("no-cache");
  expect(firstAsset.headers()["referrer-policy"]).toBe("no-referrer");
  expect(firstAsset.headers()["x-content-type-options"]).toBe("nosniff");
  expect(firstAsset.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  expect(firstAsset.headers()["content-security-policy"]).toContain("sandbox");
  expect(firstAsset.headers()["content-security-policy"]).toContain(
    "default-src 'none'",
  );
  const firstSvg = await firstAsset.text();
  expect(firstSvg).toContain("<svg");
  expect(firstSvg).not.toMatch(/wrq_v1|qr_token/i);

  const qrPng = PNG.sync.read(await image.screenshot());
  const decodedQr = jsQR(
    Uint8ClampedArray.from(qrPng.data),
    qrPng.width,
    qrPng.height,
  );
  expect(decodedQr).not.toBeNull();
  const decodedUrl = new URL(decodedQr!.data);
  const credentialParts = decodedUrl.hash.slice(1).split(".");
  expect(decodedUrl.origin).toBe("http://127.0.0.1:3101");
  expect(decodedUrl.pathname).toBe(
    "/scan/cart/c/40000000-0000-4000-8000-000000000099",
  );
  expect(decodedUrl.search).toBe("");
  expect(credentialParts.slice(0, 3)).toEqual(["v1", "cart", "wrq_v1"]);
  expect(credentialParts).toHaveLength(5);
  expect(credentialParts[3]).toHaveLength(43);
  expect(credentialParts[4]).toHaveLength(43);
  expect(/^[A-Za-z0-9_-]+$/.test(credentialParts[3])).toBe(true);
  expect(/^[A-Za-z0-9_-]+$/.test(credentialParts[4])).toBe(true);

  await page.reload();
  const secondAsset = await page.request.get(assetPath!);
  expect(await secondAsset.text()).toBe(firstSvg);
});

test("固定 QR 可下載含車號的 SVG 並呼叫瀏覽器列印", async ({ page, request }) => {
  await loginAsSupervisor(page, request);
  await page.getByRole("link", { name: "管理洗衣車與固定 QR" }).click();
  await page.getByRole("link", { name: "查看 CART-MAIN-01 固定 QR" }).click();

  const downloadPath = await page
    .getByRole("link", { name: "下載 SVG" })
    .getAttribute("href");
  expect(downloadPath).toBe(
    "/app/admin/laundry-carts/40000000-0000-4000-8000-000000000099/qr-asset/svg?download=1",
  );
  const download = await page.request.get(downloadPath!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toBe(
    'attachment; filename="CART-MAIN-01-fixed-qr.svg"',
  );
  expect(await download.text()).toContain(">CART-MAIN-01</text>");

  await page.evaluate(() => {
    window.print = () => document.body.setAttribute("data-print-called", "true");
  });
  await page.getByRole("button", { name: "列印固定 QR" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-called", "true");

  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("link", { name: "返回洗衣車清單" }),
  ).toBeHidden();
  await expect(page.getByRole("link", { name: "下載 SVG" })).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "例外撤銷與重發" }),
  ).toBeHidden();
});

test("洗衣主管確認例外理由後可撤銷舊 QR 並重發新版本", async ({
  page,
  request,
}) => {
  await loginAsSupervisor(page, request);
  await page.getByRole("link", { name: "管理洗衣車與固定 QR" }).click();
  await page.getByRole("link", { name: "查看 CART-MAIN-01 固定 QR" }).click();

  const assetPath = await page
    .getByRole("img", { name: "CART-MAIN-01 固定 QR" })
    .getAttribute("src");
  const originalSvg = await (await page.request.get(assetPath!)).text();

  await page.getByLabel("例外重發理由").fill("車卡疑似外洩，撤銷舊權杖");
  await page
    .getByLabel("我確認這是外洩、損壞或遺失的例外重發")
    .check();
  await page.getByRole("button", { name: "撤銷舊 QR 並重發" }).click();

  await expect(page.getByRole("status")).toContainText(
    "舊 QR 已撤銷，已重發版本 2",
  );
  await expect(page.getByText("2", { exact: true })).toBeVisible();
  const reissuedSvg = await (await page.request.get(assetPath!)).text();
  expect(reissuedSvg).not.toBe(originalSvg);

  const recordedChange = await (
    await request.get(`${fakeSupabaseOrigin}/__test/last-laundry-cart-change`)
  ).json();
  expect(recordedChange).toMatchObject({
    operation: "reissue",
    target_laundry_cart_id: "40000000-0000-4000-8000-000000000099",
    change_reason: "車卡疑似外洩，撤銷舊權杖",
  });
  expect(recordedChange.change_request_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(JSON.stringify(recordedChange)).not.toMatch(/wrq_v1|qr_token/i);
  const reissuedContentExcludingTargetUrl = (await page.content()).replace(
    /<p[^>]*class="[^"]*qrTargetUrl[^"]*"[\s\S]*?<\/p>/i,
    "",
  );
  expect(reissuedContentExcludingTargetUrl).not.toMatch(/wrq_v1|qr_token/i);
});

test("洗衣員沒有洗衣車管理入口且直接頁面與 SVG 均被阻擋", async ({
  page,
  request,
}) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);

  await expect(page).toHaveURL(/\/app\/operations$/);
  await expect(
    page.getByRole("link", { name: "管理洗衣車與固定 QR" }),
  ).toHaveCount(0);

  await page.goto("/app/admin/laundry-carts");
  await expect(page).toHaveURL(/\/app\/operations$/);
  await page.goto(
    "/app/admin/laundry-carts/40000000-0000-4000-8000-000000000099/qr",
  );
  await expect(page).toHaveURL(/\/app\/operations$/);

  const assetResponse = await page.request.get(
    "/app/admin/laundry-carts/40000000-0000-4000-8000-000000000099/qr-asset/svg",
    { maxRedirects: 0 },
  );
  expect(assetResponse.status()).not.toBe(200);
  expect(await assetResponse.text()).not.toContain("<svg");
});

test("單一據點主管直接輸入他據點車輛頁面與 SVG 仍取得不到資料", async ({
  page,
  request,
}) => {
  await loginAsSupervisor(page, request);

  const pageResponse = await page.request.get(
    "/app/admin/laundry-carts/40000000-0000-4000-8000-000000000098/qr",
  );
  expect(await pageResponse.text()).not.toContain("CART-CORP-01 固定 QR");

  const assetResponse = await page.request.get(
    "/app/admin/laundry-carts/40000000-0000-4000-8000-000000000098/qr-asset/svg",
    { maxRedirects: 0 },
  );
  expect(assetResponse.status()).toBe(404);
  expect(assetResponse.headers()["cache-control"]).toContain("no-store");
  expect(assetResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(assetResponse.headers()["x-robots-tag"]).toContain("noindex");
  expect(await assetResponse.text()).not.toContain("<svg");
});
