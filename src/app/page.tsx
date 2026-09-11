import type { Metadata } from "next";
import Link from "next/link";

import styles from "./login/login.module.css";

export const metadata: Metadata = {
  title: "洗衣管理系統",
};

export default function HomePage() {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="home-title">
        <div className={styles.brandMark} aria-hidden="true">WR</div>
        <header>
          <p className={styles.eyebrow}>INTERNAL OPERATIONS</p>
          <h1 id="home-title">洗衣管理系統</h1>
          <p className={styles.lede}>
            作業據點洗衣作業入口。一般送洗人員請掃描固定洗衣車 QR；內部人員請登入作業台。
          </p>
        </header>
        <p className={styles.loginForm}>
          <Link className={styles.homeCta} href="/login">登入作業台</Link>
        </p>
        <p className={styles.securityNote}>
          系統狀態與健康檢查請走獨立的狀態頁，不在此頁顯示設定細節。
        </p>
        <Link className={styles.statusLink} href="/status">查看系統狀態</Link>
      </section>
    </main>
  );
}
