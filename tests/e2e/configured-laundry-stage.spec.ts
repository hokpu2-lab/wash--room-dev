import { expect, test } from "@playwright/test";

import { submitPasswordLogin } from "./password-login";

const fakeSupabaseOrigin = "http://127.0.0.1:54390";
const equipmentId = "41000000-0000-4000-8000-000000000099";

test("洗衣員掃相容洗衣機 QR 後開始清洗並占用設備", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  const token = (await (await request.get(`${fakeSupabaseOrigin}/__test/laundry-equipment-token/${equipmentId}`)).json()).token as string;
  await page.goto("/login");
  await submitPasswordLogin(page);
  await expect(page).toHaveURL(/\/app\/operations$/);
  await page.goto(`/scan/equipment#v1.equipment.${token}`);
  await expect(page).toHaveURL(/\/app\/operations\/washing/);
  await expect(page).toHaveURL(/mode=start/);
  await expect(page.getByText("已掃描洗衣機")).toBeVisible();
  await expect(page.getByRole("option", { name: /MAIN-20260808-0001/ })).toBeAttached();
  await expect(page.getByRole("button", { name: "確認開始清洗" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "確認清洗完成" })).toHaveCount(0);
  await page.getByRole("button", { name: "確認開始清洗" }).click();
  await expect(page.getByRole("status")).toContainText("清洗已開始");
  expect(page.url()).toMatch(/\/app\/operations\/washing/);
  expect(await page.content()).not.toContain(token);

  await page.goto(`/scan/equipment#v1.equipment.${token}`);
  await expect(page).toHaveURL(/mode=complete/);
  await expect(page.getByRole("button", { name: "確認清洗完成" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "確認開始清洗" })).toHaveCount(0);
  await page.getByRole("button", { name: "確認清洗完成" }).click();
  await expect(page.getByRole("status")).toContainText("清洗已結束");
});

test("相機丢掉 hash 時仍可用設備路徑進入開始清洗", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await page.goto(`/scan/equipment/e/${equipmentId}`);
  await expect(page).toHaveURL(/\/app\/operations\/washing/);
  await expect(page.getByRole("button", { name: "確認開始清洗" })).toBeEnabled();
});

test("掃本館洗衣機只載入本館批次，不會帶入法人洗衣車", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/organization-supervisor`);
  const token = (
    await (
      await request.get(`${fakeSupabaseOrigin}/__test/laundry-equipment-token/${equipmentId}`)
    ).json()
  ).token as string;

  await page.goto("/login");
  await submitPasswordLogin(page, /\/app\/admin/);
  await page.goto(`/scan/equipment#v1.equipment.${token}`);
  await expect(page).toHaveURL(/site=20000000-0000-4000-8000-000000000099/);
  await expect(
    page.locator("select option[value='61000000-0000-4000-8000-000000000098']"),
  ).toHaveCount(0);
  await expect(
    page.locator("select option[value='61000000-0000-4000-8000-000000000099']"),
  ).toHaveCount(1);
});

test("未登入掃洗衣機 QR 會引導登入後進入清洗控制點", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  const token = (
    await (
      await request.get(`${fakeSupabaseOrigin}/__test/laundry-equipment-token/${equipmentId}`)
    ).json()
  ).token as string;

  await page.goto(`/scan/equipment#v1.equipment.${token}`);
  await expect(page.getByRole("button", { name: "前往登入後開始清洗" })).toBeVisible();
  await page.getByRole("button", { name: "前往登入後開始清洗" }).click();
  await submitPasswordLogin(page, /\/(scan\/equipment|app\/operations\/washing)/);
  await expect(page).toHaveURL(/\/app\/operations\/washing/);
  await expect(page.getByText("已掃描洗衣機")).toBeVisible();
});

test("設備掃碼在 hash 稍後到達時仍可進入控制點", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  const token = (
    await (
      await request.get(`${fakeSupabaseOrigin}/__test/laundry-equipment-token/${equipmentId}`)
    ).json()
  ).token as string;

  await page.goto("/login");
  await submitPasswordLogin(page);
  await page.goto("/scan/equipment");
  await page.evaluate((value) => {
    window.location.hash = `v1.equipment.${value}`;
  }, token);
  await expect(page).toHaveURL(/\/app\/operations\/washing/);
  await expect(page.getByText("已掃描洗衣機")).toBeVisible();
});
