import type { Metadata } from "next";

import { getPublicSupabaseConfiguration } from "@/lib/supabase/config";

import styles from "./status.module.css";

export const metadata: Metadata = {
  title: "系統狀態",
};

export default function StatusPage() {
  const supabaseConfigured = getPublicSupabaseConfiguration() !== null;

  return (
    <main className={styles.statusShell}>
      <section className={styles.statusPanel} aria-labelledby="status-title">
        <header className={styles.statusHeader}>
          <p className={styles.eyebrow}>WASH ROOM · INTERNAL OPERATIONS</p>
          <h1 id="status-title">系統狀態</h1>
          <p className={styles.lede}>
            這個頁面只顯示服務準備狀態，不會公開帳號、設備或營運資料。
          </p>
        </header>

        <dl className={styles.statusList}>
          <div className={styles.statusItem}>
            <dt>
              <span
                className={`${styles.statusDot} ${styles.statusDotReady}`}
                aria-hidden="true"
              />
              網站服務
            </dt>
            <dd>
              <strong>應用程式已啟動</strong>
              <span>Next.js 服務可正常回應。</span>
            </dd>
          </div>

          <div className={styles.statusItem}>
            <dt>
              <span
                className={`${styles.statusDot} ${
                  supabaseConfigured
                    ? styles.statusDotReady
                    : styles.statusDotWaiting
                }`}
                aria-hidden="true"
              />
              資料服務
            </dt>
            <dd>
              <strong>
                {supabaseConfigured ? "Supabase 已設定" : "Supabase 尚未設定"}
              </strong>
              <span>
                {supabaseConfigured
                  ? "必要的瀏覽器安全連線設定已提供。"
                  : "必要的公開連線設定尚未完整提供；完成後才會開放正式營運功能。"}
              </span>
            </dd>
          </div>
        </dl>

        <aside className={styles.continuityNote} aria-label="服務中斷應變方式">
          <span aria-hidden="true">i</span>
          <p>
            若正式服務中斷，請先依現場程序使用紙本記錄，待服務恢復後再補登。
          </p>
        </aside>
      </section>
    </main>
  );
}
