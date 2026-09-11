import { expect, test } from "@playwright/test";

import { submitPasswordLogin } from "./password-login";

const fakeSupabaseOrigin = "http://127.0.0.1:54390";

async function loginAsSupervisor(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, mode: "supervisor" | "organization-supervisor" = "supervisor") {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/${mode}`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/admin/);
}

test("單一據點主管只看得到本館設備，且可登錄設備並保留固定 QR", async ({ page, request }) => {
  await loginAsSupervisor(page, request);
  await page.getByRole("link", { name: "管理洗衣設備與固定 QR" }).click();
  await expect(page.getByRole("heading", { name: "洗衣設備與固定 QR" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "WASHER MAIN 01", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "DRYER CORP 01", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: /新增設備/ }).click();
  const createForm = page.locator("form").filter({ has: page.getByRole("button", { name: "登錄設備" }) });
  await createForm.getByLabel("設備名稱").fill("  washer test 01 ");
  await createForm.getByLabel("作業據點代碼").selectOption("MAIN");
  await createForm.getByLabel("汙衣").check();
  await createForm.getByLabel("圍兜").check();
  await createForm.getByLabel("登錄理由").fill("新增本館洗衣機");
  await page.getByRole("button", { name: "登錄設備" }).click();
  await expect(page.getByRole("status")).toContainText("設備資料已儲存");
  await page.getByRole("tab", { name: /設備清單/ }).click();
  await expect(page.getByRole("cell", { name: "WASHER TEST 01", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /修改設備/ }).click();
  const editForm = page.getByRole("form", { name: "修改設備資料" });
  await editForm.getByLabel("選擇設備").selectOption({ label: "WASHER TEST 01" });
  await editForm.getByLabel("設備名稱").fill("WASHER TEST 01B");
  await editForm.getByLabel("可容納洗衣車（台）").fill("2");
  await editForm.getByLabel("設備狀態").selectOption("maintenance");
  await editForm.getByLabel("異動理由").fill("更正名稱與容量");
  await editForm.getByRole("button", { name: "儲存設備資料" }).click();
  await expect(page.getByRole("status")).toContainText("設備資料已儲存");
  await page.getByRole("tab", { name: /設備清單/ }).click();
  await expect(page.getByRole("cell", { name: "WASHER TEST 01B", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /刪除誤建/ }).click();
  const deleteForm = page.getByRole("form", { name: "刪除未使用設備" });
  await deleteForm.getByLabel("選擇要刪除的設備").selectOption({ label: "WASHER TEST 01B" });
  await deleteForm.getByLabel(/再次輸入設備名稱/).fill("WASHER TEST 01B");
  await deleteForm.getByLabel("刪除原因").fill("刪除誤建且未使用設備");
  await deleteForm.getByLabel(/我確認設備建立錯誤/).check();
  await deleteForm.getByRole("button", { name: "永久刪除設備" }).click();
  await expect(page.getByRole("status")).toContainText("未使用設備已刪除");
  await page.getByRole("tab", { name: /設備清單/ }).click();
  await expect(page.getByRole("cell", { name: "WASHER TEST 01B", exact: true })).toHaveCount(0);
  const deletion = await (await request.get(`${fakeSupabaseOrigin}/__test/last-laundry-equipment-change`)).json();
  expect(deletion).toMatchObject({
    operation: "delete",
    expected_equipment_name: "WASHER TEST 01B",
    change_reason: "刪除誤建且未使用設備",
  });

  await page.getByRole("link", { name: "查看 WASHER MAIN 01 固定 QR" }).click();
  const image = page.getByRole("img", { name: "WASHER MAIN 01 固定 QR" });
  const assetPath = await image.getAttribute("src");
  expect(assetPath).toContain("/qr-asset/svg");
  expect(page.url()).not.toMatch(/wrq_v1|qr_token/i);
  const first = await page.request.get(assetPath!);
  expect(first.headers()["cache-control"]).toContain("no-store");
  const original = await first.text();
  expect(original).not.toMatch(/wrq_v1|qr_token/i);
  await page.reload();
  expect(await (await page.request.get(assetPath!)).text()).toBe(original);
});

test("洗衣主管確認例外後才能重發設備 QR，下載與跨據點頁面仍受保護", async ({ page, request }) => {
  await loginAsSupervisor(page, request, "organization-supervisor");
  await page.getByRole("link", { name: "管理洗衣設備與固定 QR" }).click();
  await page.getByRole("link", { name: "查看 DRYER CORP 01 固定 QR" }).click();
  const assetPath = await page.getByRole("img", { name: "DRYER CORP 01 固定 QR" }).getAttribute("src");
  const original = await (await page.request.get(assetPath!)).text();
  await page.getByLabel("例外重發理由").fill("設備 QR 損壞重發");
  await page.getByLabel("我確認這是例外重發").check();
  await page.getByRole("button", { name: "撤銷舊 QR 並重發" }).click();
  await expect(page.getByRole("status")).toContainText("舊 QR 已撤銷，已重發版本 2");
  expect(await (await page.request.get(assetPath!)).text()).not.toBe(original);
  const download = await page.request.get(`${assetPath}?download=1`);
  expect(download.headers()["content-disposition"]).toContain("DRYER CORP 01-fixed-qr.svg");
  const recorded = await (await request.get(`${fakeSupabaseOrigin}/__test/last-laundry-equipment-change`)).json();
  expect(recorded).toMatchObject({ operation: "reissue", target_laundry_equipment_id: "41000000-0000-4000-8000-000000000098", change_reason: "設備 QR 損壞重發" });
  expect(JSON.stringify(recorded)).not.toMatch(/wrq_v1|qr_token/i);
});

test("洗衣員沒有設備管理入口且直接設備頁面與 SVG 受阻擋", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/operations$/);
  await expect(page.getByRole("link", { name: "管理洗衣設備與固定 QR" })).toHaveCount(0);
  await page.goto("/app/admin/laundry-equipment");
  await expect(page).toHaveURL(/\/app\/operations$/);
  const response = await page.request.get("/app/admin/laundry-equipment/41000000-0000-4000-8000-000000000099/qr-asset/svg", { maxRedirects: 0 });
  expect(response.status()).not.toBe(200);
});
