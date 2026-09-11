import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getPasswordChangeState } from "@/lib/auth/password-change";

import styles from "../../login/login.module.css";
import { changeRequiredPasswordAction } from "./actions";
import { PasswordSubmit } from "./password-submit";

export const metadata: Metadata = {
  title: "設定新密碼",
};

type ChangePasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ChangePasswordPage({
  searchParams,
}: ChangePasswordPageProps) {
  const state = await getPasswordChangeState();
  if (state.kind === "anonymous") redirect("/login");
  if (state.kind === "not_required") redirect("/app");
  if (state.kind === "unavailable") redirect("/auth/denied");

  const query = await searchParams;
  const errorMessage =
    query.error === "current_password_incorrect"
      ? "目前密碼不正確，請重新輸入。"
      : query.error
        ? "密碼未儲存。請確認新密碼符合規則且兩次輸入一致。"
        : null;

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="password-title">
        <div className={styles.brandMark} aria-hidden="true">
          WR
        </div>
        <header>
          <p className={styles.eyebrow}>FIRST SIGN-IN SECURITY</p>
          <h1 id="password-title">設定新的登入密碼</h1>
          <p className={styles.lede}>
            帳號 {state.loginName} 使用的是暫時密碼。完成更換前，系統不會開放任何工作區功能。
          </p>
        </header>

        <form action={changeRequiredPasswordAction} className={styles.loginForm}>
          <label>
            <span>目前的暫時密碼</span>
            <input
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
            />
          </label>
          <label>
            <span>新密碼</span>
            <input
              name="new_password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <label>
            <span>再次輸入新密碼</span>
            <input
              name="password_confirmation"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <p className={styles.securityNote}>
            至少 12 字元，並包含英文大寫、小寫、數字與符號；不可與暫時密碼相同。
          </p>
          {errorMessage ? (
            <p className={styles.formError} role="alert">
              {errorMessage}
            </p>
          ) : null}
          <PasswordSubmit />
        </form>
      </section>
    </main>
  );
}
