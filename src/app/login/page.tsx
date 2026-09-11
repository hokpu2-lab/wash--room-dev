import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { getPublicSupabaseConfiguration } from "@/lib/supabase/config";

import { signInWithPassword } from "./actions";
import { LoginError } from "./login-error";
import { LoginSubmit } from "./login-submit";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "登入",
};

const allowedNext = new Set(["/scan/cart", "/scan/equipment"]);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = typeof query.next === "string" && allowedNext.has(query.next) ? query.next : "";
  const supabaseConfigured = getPublicSupabaseConfiguration() !== null;

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brandMark} aria-hidden="true">
          WR
        </div>

        <header>
          <p className={styles.eyebrow}>INTERNAL OPERATIONS</p>
          <h1 id="login-title">登入洗衣管理系統</h1>
          <p className={styles.lede}>
            洗衣員、洗衣主管與送洗機構主管請使用管理者建立的登入帳號。
          </p>
        </header>

        <form action={signInWithPassword} className={styles.loginForm}>
          <label>
            <span>登入帳號</span>
            <input
              name="login_name"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={64}
              disabled={!supabaseConfigured}
            />
          </label>
          <label>
            <span>密碼</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              disabled={!supabaseConfigured}
            />
          </label>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <Suspense fallback={null}>
            <LoginError />
          </Suspense>
          <LoginSubmit disabled={!supabaseConfigured} />
        </form>

        {!supabaseConfigured ? (
          <p className={styles.configurationNotice} role="status">
            <strong>Supabase 尚未完成設定</strong>
            管理者完成安全連線設定後，才會開放帳號密碼登入。
          </p>
        ) : null}

        <p className={styles.securityNote}>
          登入成功後，系統仍會核對帳號狀態、角色與有效授權範圍。首次登入必須先更換暫時密碼。
        </p>

        <Link className={styles.statusLink} href="/status">
          查看系統狀態
        </Link>
      </section>
    </main>
  );
}
