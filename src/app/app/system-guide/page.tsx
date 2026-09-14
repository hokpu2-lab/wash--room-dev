import { redirect } from "next/navigation";

import { requirePrincipal } from "@/lib/auth/principal";
import { isSystemGuideAdministrator } from "@/lib/auth/system-guide-access";

import { GuideTabs } from "./guide-tabs";
import { MarkdownDocument } from "./markdown-document";
import { loadSystemGuideDocuments } from "./system-guide-documents";
import styles from "./system-guide.module.css";

export default async function SystemGuidePage() {
  const principal = await requirePrincipal();
  if (!isSystemGuideAdministrator(principal)) {
    redirect("/auth/denied");
  }

  const documents = await loadSystemGuideDocuments();

  return (
    <main className={styles.shell}>
      <section className={styles.hero} aria-labelledby="system-guide-title">
        <div>
          <p className={styles.eyebrow}>SYSTEM GUIDE</p>
          <h1 id="system-guide-title">系統說明</h1>
          <p className={styles.lede}>使用者操作、管理設定與 AI Agent 交接集中在同一個頁面；左側工作台選單會持續保留。</p>
        </div>
        <div className={styles.accessBadge}>
          <span aria-hidden="true">●</span>
          暫限系統管理員
        </div>
      </section>

      <section className={styles.performanceNote} aria-label="載入方式">
        <strong>快速開啟</strong>
        <span>文件隨部署版本載入，不查營運資料庫；左側連結沿用 hover／focus／touch intent prefetch，頁內分類切換不重新送出頁面請求。</span>
      </section>

      <GuideTabs tabs={documents.map(({ id, label, description }) => ({ id, label, description }))}>
        {documents.map((document) => (
          <article key={document.id} className={`${styles.document} system-guide-markdown`}>
            <MarkdownDocument source={document.source} />
          </article>
        ))}
      </GuideTabs>
    </main>
  );
}
