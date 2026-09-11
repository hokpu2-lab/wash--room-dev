"use client";

import styles from "./workspace.module.css";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="workspace-error-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>WORKSPACE ERROR</p>
            <h1 id="workspace-error-title">作業畫面暫時無法載入</h1>
            <p className={styles.lede}>請再試一次。若持續發生，請聯絡洗衣主管。</p>
          </div>
        </header>
        <button type="button" className={styles.primaryLink} onClick={reset}>
          重新載入
        </button>
      </section>
    </main>
  );
}
