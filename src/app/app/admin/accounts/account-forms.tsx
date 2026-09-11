"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import type { ManagedAccount } from "@/lib/auth/account-management-schema";

import styles from "../../workspace.module.css";
import {
  createManagedAccount,
  deleteManagedAccount,
  importManagedAccountPermissions,
  resetManagedAccountPassword,
  updateManagedAccount,
} from "./actions";

type ScopeOption = { code: string; name: string; active: boolean };

function SubmitButton({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus();
  return (
    <button type="submit" disabled={status.pending} aria-busy={status.pending}>
      {status.pending ? pending : idle}
    </button>
  );
}

function PasswordFields() {
  const [visible, setVisible] = useState(false);
  return (
    <fieldset className={styles.accountPasswordFields}>
      <legend>一次性暫時密碼</legend>
      <p>至少 12 碼，需包含大小寫英文、數字及符號；系統不會保存或再次顯示。</p>
      <label>
        暫時密碼
        <input name="temporary_password" type={visible ? "text" : "password"} minLength={12} maxLength={72} autoComplete="new-password" required />
      </label>
      <label>
        再次輸入暫時密碼
        <input name="password_confirmation" type={visible ? "text" : "password"} minLength={12} maxLength={72} autoComplete="new-password" required />
      </label>
      <label className={styles.checkboxLabel}>
        <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
        顯示本次輸入的密碼
      </label>
    </fieldset>
  );
}

function PermissionFields({
  sites,
  institutions,
  account,
}: {
  sites: ScopeOption[];
  institutions: ScopeOption[];
  account?: ManagedAccount;
}) {
  const selected = useMemo(
    () => new Set(
      account?.memberships.filter((item) => item.active).map((item) =>
        item.site_code
          ? `${item.role}|site|${item.site_code}`
          : `${item.role}|institution|${item.institution_code}`,
      ) ?? [],
    ),
    [account],
  );
  return (
    <fieldset className={styles.permissionMatrix}>
      <legend>角色與資料權限</legend>
      <p>可同時設定多個角色及範圍；未勾選的既有權限會停用。</p>
      <div className={styles.permissionColumns}>
        <PermissionGroup title="系統管理員" role="system_administrator" options={sites} selected={selected} scopeType="site" />
        <PermissionGroup title="洗衣主管" role="laundry_supervisor" options={sites} selected={selected} scopeType="site" />
        <PermissionGroup title="洗衣員" role="laundry_worker" options={sites} selected={selected} scopeType="site" />
        <PermissionGroup title="送洗機構主管" role="institution_supervisor" options={institutions} selected={selected} scopeType="institution" />
      </div>
    </fieldset>
  );
}

function PermissionGroup({
  title,
  role,
  options,
  selected,
  scopeType,
}: {
  title: string;
  role: string;
  options: ScopeOption[];
  selected: Set<string>;
  scopeType: "site" | "institution";
}) {
  return (
    <section>
      <strong>{title}</strong>
      {options.map((option) => {
        const value = `${role}|${scopeType}|${option.code}`;
        return (
          <label className={styles.checkboxLabel} key={value}>
            <input name="permissions" type="checkbox" value={value} defaultChecked={selected.has(value)} disabled={!option.active} />
            {option.name} · {option.code}{option.active ? "" : "（停用）"}
          </label>
        );
      })}
    </section>
  );
}

export function AccountEditor({
  mode,
  account,
  sites,
  institutions,
  requestId,
}: {
  mode: "create" | "edit";
  account?: ManagedAccount;
  sites: ScopeOption[];
  institutions: ScopeOption[];
  requestId: string;
}) {
  const creating = mode === "create";
  return (
    <form action={creating ? createManagedAccount : updateManagedAccount} className={styles.accountEditor} aria-label={creating ? "新增登入帳號" : `編輯 ${account?.login_name ?? "帳號"}`}>
      <input type="hidden" name="change_request_id" value={requestId} />
      {account ? <input type="hidden" name="profile_id" value={account.profile_id} /> : null}
      <div className={styles.formGrid}>
        <label>
          登入帳號（區分大小寫）
          <input name="login_name" defaultValue={account?.login_name ?? ""} minLength={3} maxLength={64} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          <small>輸入大寫就會保存為大寫，登入時也必須使用相同大小寫。</small>
        </label>
        <label>
          顯示名稱
          <input name="display_name" defaultValue={account?.display_name ?? ""} maxLength={80} placeholder="例如：王小明" />
        </label>
        <label>
          通知 Email
          <input name="notification_email" type="email" defaultValue={account?.notification_email ?? ""} maxLength={254} placeholder="只用於通知或備援" />
        </label>
        {!creating ? (
          <label className={styles.checkboxLabel}>
            <input name="account_active" type="checkbox" defaultChecked={account?.account_active} />
            帳號啟用
          </label>
        ) : null}
      </div>
      <PermissionFields sites={sites} institutions={institutions} account={account} />
      {creating ? <PasswordFields /> : null}
      <label>
        {creating ? "建立理由" : "異動理由"}
        <input name="change_reason" maxLength={500} required />
      </label>
      <SubmitButton idle={creating ? "建立帳號與權限" : "儲存帳號與權限"} pending={creating ? "正在安全建立…" : "正在安全更新…"} />
    </form>
  );
}

export function PasswordResetForm({ accounts, requestId }: { accounts: ManagedAccount[]; requestId: string }) {
  const candidates = accounts.filter((account) => account.account_active && !account.deleted_at && !account.is_current_account && account.auth_identity_configured);
  return (
    <form action={resetManagedAccountPassword} className={styles.accountEditor} aria-label="重設帳號密碼">
      <input type="hidden" name="change_request_id" value={requestId} />
      <label>
        選擇帳號
        <select name="profile_id" required defaultValue={candidates[0]?.profile_id ?? ""}>
          {candidates.length === 0 ? <option value="">目前沒有可重設的帳號</option> : null}
          {candidates.map((account) => <option key={account.profile_id} value={account.profile_id}>{account.login_name} · {account.display_name ?? "未填顯示名稱"}</option>)}
        </select>
      </label>
      <PasswordFields />
      <label>重設理由<input name="change_reason" maxLength={500} required /></label>
      <SubmitButton idle="設定暫時密碼並強制修改" pending="正在重設密碼…" />
    </form>
  );
}

export function AccountDeleteForm({ accounts, requestId }: { accounts: ManagedAccount[]; requestId: string }) {
  const candidates = accounts.filter((account) => !account.deleted_at && !account.is_current_account);
  return (
    <form action={deleteManagedAccount} className={`${styles.accountEditor} ${styles.dangerZone}`} aria-label="刪除登入帳號">
      <input type="hidden" name="change_request_id" value={requestId} />
      <label>
        選擇帳號
        <select name="profile_id" required defaultValue={candidates[0]?.profile_id ?? ""}>
          {candidates.length === 0 ? <option value="">目前沒有可刪除的帳號</option> : null}
          {candidates.map((account) => <option key={account.profile_id} value={account.profile_id}>{account.login_name} · {account.display_name ?? "未填顯示名稱"}</option>)}
        </select>
      </label>
      <label>再次輸入登入帳號（大小寫必須一致）<input name="expected_login_name" autoCapitalize="none" autoCorrect="off" spellCheck={false} required /></label>
      <label>刪除理由<input name="change_reason" maxLength={500} required /></label>
      <label className={styles.checkboxLabel}><input name="confirmed" type="checkbox" value="yes" required />我確認撤銷 Auth 身分與全部權限；歷史及稽核仍永久保留。</label>
      <SubmitButton idle="刪除帳號" pending="正在撤銷帳號…" />
    </form>
  );
}

export function BatchPermissionForm({ requestId }: { requestId: string }) {
  return (
    <form action={importManagedAccountPermissions} className={styles.accountEditor} aria-label="批次維護帳號權限">
      <input type="hidden" name="change_request_id" value={requestId} />
      <p>
        只更新已由本模組建立且已有 Auth 身分的帳號；這個批次工具不會建立帳號或產生未綁定的 profile。
        新帳號請使用「新增帳號」，每列代表一個角色與資料範圍。
      </p>
      <label>
        權限 CSV
        <input name="permission_csv" type="file" accept=".csv,text/csv" required />
      </label>
      <label>
        批次異動理由
        <input name="change_reason" maxLength={500} required />
      </label>
      <div className={styles.csvHeaders}>
        <strong>固定欄位順序</strong>
        <code>login_name,role,site_code,institution_code,account_active,membership_active</code>
      </div>
      <SubmitButton idle="套用批次權限" pending="正在套用批次權限…" />
    </form>
  );
}
