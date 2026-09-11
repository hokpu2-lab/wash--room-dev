import type { Metadata } from "next";
import Link from "next/link";

import styles from "./denied.module.css";

export const metadata: Metadata = {
  title: "無法進入系統",
};

export default function AccessDeniedPage() {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="denied-title">
        <p className={styles.code}>ACCESS NOT AVAILABLE</p>
        <h1 id="denied-title">此帳號目前無法使用系統</h1>
        <p>
          此登入帳號目前沒有可用的系統權限。請聯絡洗衣主管確認帳號與授權範圍。
        </p>
        <Link href="/login">返回登入頁</Link>
      </section>
    </main>
  );
}
