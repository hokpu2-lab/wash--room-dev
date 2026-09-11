import { expect, test } from "@playwright/test";

import { submitPasswordLogin } from "./password-login";

const fakeSupabaseOrigin = "http://127.0.0.1:54390";

test.beforeEach(async ({ request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/supervisor`);
});

test("洗衣主管可完成帳號新增、編輯、重設密碼與安全刪除", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await submitPasswordLogin(page);
  await page.goto("/app/admin/accounts");

  await expect(
    page.getByRole("heading", { level: 1, name: "帳號與權限管理" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /帳號清單/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /新增帳號/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /編輯帳號/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /密碼管理/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /刪除帳號/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /批次權限/ })).toBeVisible();

  await page.getByRole("tab", { name: /批次權限/ }).click();
  const batchForm = page.getByRole("form", { name: "批次維護帳號權限" });
  await batchForm.getByLabel("權限 CSV").setInputFiles({
    name: "managed-permissions.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "login_name,role,site_code,institution_code,account_active,membership_active\nexisting.worker,laundry_worker,MAIN,,true,true\n",
    ),
  });
  await batchForm.getByLabel("批次異動理由").fill("確認帳號模組批次權限");
  await batchForm.getByRole("button", { name: "套用批次權限" }).click();
  await expect(page.getByRole("status")).toContainText("已套用批次權限異動");
  const batchChange = await (
    await request.get(`${fakeSupabaseOrigin}/__test/last-access-change`)
  ).json();
  expect(batchChange).toMatchObject({
    change_reason: "確認帳號模組批次權限",
    change_rows: [
      expect.objectContaining({
        login_name: "existing.worker",
        email: "existing.worker@auth.wash-room.invalid",
      }),
    ],
  });

  await page.getByRole("tab", { name: /新增帳號/ }).click();
  const createForm = page.getByRole("form", { name: "新增登入帳號" });
  await createForm.getByLabel("登入帳號（區分大小寫）").fill("WorkerABC");
  await createForm.getByLabel("顯示名稱").fill("王小明");
  await createForm.getByLabel("通知 Email").fill("WorkerABC@Example.Test");
  await createForm
    .locator('input[name="permissions"][value="laundry_worker|site|MAIN"]')
    .check();
  await createForm.getByLabel("暫時密碼", { exact: true }).fill("First-Worker-42!");
  await createForm.getByLabel("再次輸入暫時密碼").fill("First-Worker-42!");
  await createForm.getByLabel("建立理由").fill("新增本館洗衣人員");
  await createForm.getByRole("button", { name: "建立帳號與權限" }).click();

  await expect(page.getByRole("status")).toContainText("帳號、Auth 身分與權限已建立");
  const createdCard = page.locator("article").filter({ hasText: "WorkerABC" });
  await expect(createdCard.getByText("WorkerABC", { exact: true })).toBeVisible();
  await expect(createdCard).toContainText("王小明");
  await expect(createdCard).toContainText("待修改密碼");

  await createdCard.getByRole("link", { name: "編輯帳號" }).click();
  const editForm = page.getByRole("form", { name: "編輯 WorkerABC" });
  await expect(editForm).toBeVisible();
  await editForm.getByLabel("登入帳號（區分大小寫）").fill("WORKERabc");
  await editForm.getByLabel("顯示名稱").fill("王小明（晚班）");
  await editForm.getByLabel("通知 Email").fill("night.shift@example.test");
  await editForm
    .locator('input[name="permissions"][value="laundry_supervisor|site|MAIN"]')
    .check();
  await editForm
    .locator('input[name="permissions"][value="institution_supervisor|institution|CARE-A"]')
    .check();
  await editForm.getByLabel("異動理由").fill("兼任晚班主管與機構聯絡人");
  await editForm.getByRole("button", { name: "儲存帳號與權限" }).click();

  await expect(page.getByRole("status")).toContainText("帳號資料與權限已更新");
  const editedCard = page.locator("article").filter({ hasText: "WORKERabc" });
  await expect(editedCard.getByText("WORKERabc", { exact: true })).toBeVisible();
  await expect(editedCard).toContainText("洗衣主管");
  await expect(editedCard).toContainText("送洗機構主管");

  await page.getByRole("tab", { name: /密碼管理/ }).click();
  const passwordForm = page.getByRole("form", { name: "重設帳號密碼" });
  const passwordProfileId = await passwordForm
    .getByLabel("選擇帳號")
    .locator("option")
    .filter({ hasText: "WORKERabc" })
    .getAttribute("value");
  await passwordForm.getByLabel("選擇帳號").selectOption(passwordProfileId!);
  await passwordForm.getByLabel("暫時密碼", { exact: true }).fill("Reset-Worker-73!");
  await passwordForm.getByLabel("再次輸入暫時密碼").fill("Reset-Worker-73!");
  await passwordForm.getByLabel("重設理由").fill("人員忘記密碼");
  await passwordForm
    .getByRole("button", { name: "設定暫時密碼並強制修改" })
    .click();
  await expect(page.getByRole("status")).toContainText("暫時密碼已重設");

  await page.getByRole("tab", { name: /刪除帳號/ }).click();
  const deleteForm = page.getByRole("form", { name: "刪除登入帳號" });
  await deleteForm.getByLabel("選擇帳號").selectOption(passwordProfileId!);
  await deleteForm.getByLabel("再次輸入登入帳號（大小寫必須一致）").fill("WORKERabc");
  await deleteForm.getByLabel("刪除理由").fill("人員離職");
  await deleteForm.getByLabel(/我確認撤銷 Auth 身分/).check();
  await deleteForm.getByRole("button", { name: "刪除帳號" }).click();

  await expect(page.getByRole("status")).toContainText("帳號 Auth 身分與全部權限已撤銷");
  await page.getByText(/查看 1 個已刪除帳號/).click();
  await expect(page.getByText("WORKERabc", { exact: true })).toBeVisible();

  const recorded = await (
    await request.get(`${fakeSupabaseOrigin}/__test/managed-accounts`)
  ).json();
  const deleted = recorded.accounts.find(
    (account: { login_name: string }) => account.login_name === "WORKERabc",
  );
  expect(deleted).toMatchObject({
    display_name: "王小明（晚班）",
    notification_email: "night.shift@example.test",
    account_active: false,
    auth_identity_configured: false,
  });
  expect(deleted.deleted_at).toEqual(expect.any(String));
  expect(deleted.memberships).toHaveLength(3);
  expect(deleted.memberships.every((membership: { active: boolean }) => !membership.active)).toBe(true);
  expect(recorded.auth_users).not.toContainEqual(
    expect.objectContaining({ email: "workerabc@auth.wash-room.invalid" }),
  );
  expect(recorded.last_change).toMatchObject({
    operation: "retire",
    change_reason: "人員離職",
  });
});

test("帳號大小寫不一致時，即使密碼正確也不能登入", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("登入帳號").fill("ADMIN");
  await page.getByLabel("密碼").fill("Temporary-Admin-42!");
  await page.getByRole("button", { name: "登入" }).click();

  await expect(page).toHaveURL(/\/login\?error=credentials$/);
  await expect(page.getByText("帳號或密碼不正確，請重新輸入。", { exact: true })).toBeVisible();
});

test("新增帳號驗證會指出缺少角色與資料範圍", async ({ page }) => {
  await page.goto("/login");
  await submitPasswordLogin(page);
  await page.goto("/app/admin/accounts#tab=create");

  const createForm = page.getByRole("form", { name: "新增登入帳號" });
  await createForm.getByLabel("登入帳號（區分大小寫）").fill("ValidationWorker");
  await createForm.getByLabel("暫時密碼", { exact: true }).fill("Validation-Worker-42!");
  await createForm.getByLabel("再次輸入暫時密碼").fill("Validation-Worker-42!");
  await createForm.getByLabel("建立理由").fill("確認逐欄驗證訊息");
  await createForm.getByRole("button", { name: "建立帳號與權限" }).click();

  await expect(page).toHaveURL(/status=invalid-permissions/);
  await expect(
    page.getByText("請至少勾選一個有效的角色與資料範圍。", { exact: true }),
  ).toBeVisible();
});

test("洗衣員不能開啟帳號管理中心", async ({ page, request }) => {
  await request.post(`${fakeSupabaseOrigin}/__test/mode/allowed`);
  await page.goto("/login");
  await submitPasswordLogin(page);
  await page.goto("/app/admin/accounts");

  await expect(page).toHaveURL(/\/app\/operations/);
  await expect(
    page.getByRole("heading", { level: 1, name: "帳號與權限管理" }),
  ).toHaveCount(0);
});
