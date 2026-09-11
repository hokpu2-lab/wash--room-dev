import { randomUUID } from "node:crypto";

import { listManagedAccounts } from "@/lib/auth/account-management";
import { accessRoleLabels } from "@/lib/auth/access-role-labels";
import { getOrganizationWorkspace } from "@/lib/organization/master-data";

import { AppLink } from "../../app-link";
import { ModuleTabs } from "../../module-tabs";
import styles from "../../workspace.module.css";
import {
  AccountDeleteForm,
  AccountEditor,
  BatchPermissionForm,
  PasswordResetForm,
} from "./account-forms";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const statusMessages: Record<string, { kind: "success" | "error"; text: string }> = {
  created: { kind: "success", text: "帳號、Auth 身分與權限已建立；請將一次性暫時密碼安全交給本人。" },
  updated: { kind: "success", text: "帳號資料與權限已更新。" },
  "password-reset": { kind: "success", text: "暫時密碼已重設；該帳號下次登入必須修改密碼。" },
  deleted: { kind: "success", text: "帳號 Auth 身分與全部權限已撤銷，歷史及稽核仍保留。" },
  "deleted-auth-pending": { kind: "error", text: "帳號權限已撤銷，但 Auth 清理暫時失敗；該帳號已無法進入系統，請稍後重試清理。" },
  "auth-admin-unavailable": { kind: "error", text: "伺服器尚未設定 SUPABASE_SERVICE_ROLE_KEY，無法管理 Auth 帳號。" },
  "invalid-create": { kind: "error", text: "新增資料不完整；請檢查帳號格式、權限及密碼強度。" },
  "invalid-login-name": { kind: "error", text: "登入帳號格式錯誤：需為 3–64 碼，開頭使用英文字母或數字，且只能包含英文字母、數字、句點、底線及連字號。" },
  "invalid-display-name": { kind: "error", text: "顯示名稱不可超過 80 個字元。" },
  "invalid-notification-email": { kind: "error", text: "通知 Email 格式錯誤；不使用時請完整留空。" },
  "invalid-permissions": { kind: "error", text: "請至少勾選一個有效的角色與資料範圍。" },
  "invalid-temporary-password": { kind: "error", text: "暫時密碼格式錯誤：需為 12–72 碼，並同時包含大小寫英文字母、數字及符號。" },
  "password-confirmation-mismatch": { kind: "error", text: "兩次輸入的暫時密碼不一致。" },
  "invalid-change-reason": { kind: "error", text: "建立或異動理由必須為 1–500 個字元。" },
  "invalid-request-id": { kind: "error", text: "本次表單識別碼已失效，請重新整理頁面後再送出。" },
  "auth-create-failed": { kind: "error", text: "Auth 帳號建立失敗，可能已有相同帳號。" },
  "create-failed": { kind: "error", text: "帳號或權限建立失敗，沒有保留可登入的半成品帳號。" },
  "identity-bind-failed": { kind: "error", text: "Auth 身分綁定失敗，新帳號已自動撤銷。" },
  "invalid-update": { kind: "error", text: "帳號修改資料不完整。" },
  "auth-update-failed": { kind: "error", text: "登入帳號同步至 Auth 失敗，資料尚未變更。" },
  "update-failed": { kind: "error", text: "帳號或權限更新失敗；Auth 登入名稱已嘗試還原。" },
  "invalid-password": { kind: "error", text: "密碼格式、確認密碼或重設理由無效。" },
  "password-account-invalid": { kind: "error", text: "只能重設其他啟用中且已建立 Auth 身分的帳號。" },
  "auth-identity-missing": { kind: "error", text: "此帳號尚未完成 Auth 身分建立。" },
  "password-reset-failed": { kind: "error", text: "無法標記強制改密碼，密碼未變更。" },
  "password-auth-failed": { kind: "error", text: "Auth 密碼更新失敗；帳號已被要求下次登入修改密碼。" },
  "invalid-delete": { kind: "error", text: "刪除確認資料不完整，帳號未刪除。" },
  "delete-confirmation-mismatch": { kind: "error", text: "帳號確認文字、大小寫或目標無效，帳號未刪除。" },
  "delete-failed": { kind: "error", text: "帳號刪除被拒絕；請確認不是本人、跨據點或最後一位主管。" },
  "batch-permissions-applied": { kind: "success", text: "已套用批次權限異動。" },
  "batch-permissions-replayed": { kind: "success", text: "批次權限異動已是冪等重送，資料未重複套用。" },
  "invalid-batch-permissions": { kind: "error", text: "批次權限 CSV 格式或內容無效，沒有任何資料被套用。" },
  "batch-unavailable": { kind: "error", text: "目前無法套用批次權限異動，請稍後再試。" },
  "batch-unmanaged-account": { kind: "error", text: "批次權限只可維護已由帳號管理模組建立的登入帳號；新帳號請使用「新增帳號」。" },
  "batch-permissions-failed": { kind: "error", text: "批次權限異動被拒絕，沒有任何資料被套用。" },
  "account-not-found": { kind: "error", text: "找不到可管理的帳號。" },
};

export default async function AccountsPage({ searchParams }: Props) {
  const query = await searchParams;
  const [accounts, workspace] = await Promise.all([listManagedAccounts(), getOrganizationWorkspace()]);
  const status = typeof query.status === "string" ? query.status : "";
  const selectedId = typeof query.account === "string" ? query.account : "";
  const selected = accounts?.find(
    (account) => account.profile_id === selectedId && !account.deleted_at && !account.is_current_account,
  ) ?? null;
  const activeAccounts = accounts?.filter((account) => !account.deleted_at) ?? [];
  const deletedAccounts = accounts?.filter((account) => account.deleted_at) ?? [];
  const message = statusMessages[status];

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="accounts-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>IDENTITY & ACCESS</p>
            <h1 id="accounts-title">帳號與權限管理</h1>
            <p className={styles.lede}>在系統內建立並維護登入帳號、資料、密碼與多角色範圍；Supabase Auth 僅作伺服器端登入憑證，不需人工建立使用者。</p>
          </div>
          <div className={styles.scopeBadges}><span><i aria-hidden="true" /><strong>{activeAccounts.length}</strong> 使用中</span><span><strong>{deletedAccounts.length}</strong> 已刪除</span></div>
        </header>

        {message ? <p className={message.kind === "success" ? styles.successNotice : styles.errorNotice} role={message.kind === "success" ? "status" : "alert"}>{message.text}</p> : null}
        {!accounts ? <p className={styles.errorNotice} role="alert">目前無法讀取帳號清單。</p> : (
          <ModuleTabs
            ariaLabel="帳號管理功能"
            storageKey="managed-accounts"
            defaultTab="list"
            tabs={[
              { id: "list", label: "帳號清單", description: "狀態、角色與權限範圍", count: activeAccounts.length },
              { id: "create", label: "新增帳號", description: "Auth、暫時密碼與初始權限" },
              { id: "edit", label: "編輯帳號", description: "名稱、Email、狀態與權限" },
              { id: "password", label: "密碼管理", description: "重設暫時密碼並強制修改" },
              { id: "delete", label: "刪除帳號", description: "撤銷 Auth 與所有權限" },
              { id: "batch", label: "批次權限", description: "既有帳號的 CSV 範圍維護" },
            ]}
          >
            <section aria-labelledby="account-list-title">
              <div className={styles.sectionHeading}><h2 id="account-list-title">目前帳號</h2><p>登入帳號原樣顯示大小寫；自己的帳號只能使用個人密碼功能，不可在此停用或刪除。</p></div>
              <div className={styles.accountCards}>
                {activeAccounts.map((account) => (
                  <article key={account.profile_id} className={styles.accountCard}>
                    <header><div><strong>{account.login_name}</strong><span>{account.display_name ?? "未填顯示名稱"}</span></div><em data-active={account.account_active}>{account.account_active ? "啟用" : "停用"}</em></header>
                    <p>{account.notification_email ?? "未設定通知 Email"}</p>
                    <div className={styles.accountPermissionTags}>
                      {account.memberships.filter((item) => item.active).map((item) => <span key={item.membership_id}>{accessRoleLabels[item.role]} · {item.site_name ?? item.institution_name} ({item.site_code ?? item.institution_code})</span>)}
                    </div>
                    <footer><span>{account.auth_identity_configured ? "Auth 已建立" : "Auth 待建立"}{account.must_change_password ? " · 待修改密碼" : ""}</span>{account.is_current_account ? <strong>目前帳號</strong> : <AppLink href={`/app/admin/accounts?account=${account.profile_id}#tab=edit`}>編輯帳號</AppLink>}</footer>
                  </article>
                ))}
              </div>
              {deletedAccounts.length ? <details className={styles.deletedAccounts}><summary>查看 {deletedAccounts.length} 個已刪除帳號</summary><ul>{deletedAccounts.map((account) => <li key={account.profile_id}><strong>{account.login_name}</strong><span>{account.display_name ?? "—"}</span><time>{account.deleted_at ? new Date(account.deleted_at).toLocaleString("zh-TW") : ""}</time></li>)}</ul></details> : null}
            </section>
            <AccountEditor mode="create" sites={workspace.sites} institutions={workspace.institutions} requestId={randomUUID()} />
            {selected ? <AccountEditor mode="edit" account={selected} sites={workspace.sites} institutions={workspace.institutions} requestId={randomUUID()} /> : <section className={styles.emptyAccountState}><h2>先從清單選擇帳號</h2><p>選擇「編輯帳號」後，可修改大小寫、顯示名稱、通知 Email、狀態及全部權限。</p></section>}
            <PasswordResetForm accounts={activeAccounts} requestId={randomUUID()} />
            <AccountDeleteForm accounts={activeAccounts} requestId={randomUUID()} />
            <BatchPermissionForm requestId={randomUUID()} />
          </ModuleTabs>
        )}
      </section>
    </main>
  );
}
