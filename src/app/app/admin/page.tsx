import { Suspense } from "react";

import { resolveWorkspaceScope, withWorkspaceScope } from "@/lib/auth/workspace-scope";

import { AppLink } from "../app-link";
import { ModuleTabs } from "../module-tabs";
import { SupervisorKpiFallback } from "../workspace-fallbacks";
import styles from "../workspace.module.css";
import { AdminLiveData, AdminScopeBadges } from "./live-data";

type AdminPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const query = await searchParams;
  const scope = await resolveWorkspaceScope(query);

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="workspace-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>TODAY AT A GLANCE</p>
            <h1 id="workspace-title">洗衣主管工作台</h1>
            <p className={styles.lede}>掌握授權據點的洗衣單、批次與設備狀態，再進入需要處理的控制點。</p>
          </div>
          <Suspense fallback={null}>
            <AdminScopeBadges />
          </Suspense>
        </header>

        <ModuleTabs
          ariaLabel="洗衣主管工作台分類"
          storageKey="admin-home"
          defaultTab="controls"
          tabs={[
            { id: "live", label: "即時營運", description: "戰情室、風險與即時佇列" },
            { id: "controls", label: "快速控制", description: "進入各管理與設定模組" },
          ]}
        >
        <section aria-label="即時營運總覽">
        <section className={styles.operationsHero} aria-labelledby="operations-summary-title">
          <div>
            <p className={styles.eyebrow}>OPERATIONS CONTROL</p>
            <h2 id="operations-summary-title">今日現場指揮中心</h2>
            <p>先處理暫停、異常與待收件，再追蹤處理中與待取件；實際狀態與預估進度分開計算。</p>
          </div>
          <AppLink href={withWorkspaceScope("/app/dashboard", scope)}>開啟洗衣單與批次 <span aria-hidden="true">→</span></AppLink>
        </section>

        <Suspense fallback={<SupervisorKpiFallback />}>
          <AdminLiveData siteId={scope.siteId ?? (typeof query.site === "string" ? query.site : undefined)} />
        </Suspense>
        </section>

        <section className={styles.quickSection} aria-labelledby="quick-actions-title">
          <div className={styles.sectionHeadingRow}>
            <div><p className={styles.eyebrow}>CONTROL CENTER</p><h2 id="quick-actions-title">主管快速控制</h2></div>
            <p>高風險異動仍須填寫原因並保留稽核。</p>
          </div>
          <div className={styles.quickGrid}>
            <AppLink href={withWorkspaceScope("/app/admin/accounts", scope)}><span>00</span><strong>帳號與權限管理<small>新增、編輯、批次權限、密碼與安全刪除</small></strong></AppLink>
            <AppLink href={withWorkspaceScope("/app/admin/organizations", scope)}><span>01</span><strong>管理作業據點與送洗機構<small>固定配對與跨據點範圍</small></strong></AppLink>
            <AppLink href={withWorkspaceScope("/app/admin/laundry-carts", scope)}><span>02</span><strong>管理洗衣車與固定 QR<small>資產建檔、啟停與例外重發</small></strong></AppLink>
            <AppLink href={withWorkspaceScope("/app/admin/procedures", scope)}><span>03</span><strong>管理洗滌分類與程序範本<small>程序階段、標準時間與版本</small></strong></AppLink>
            <AppLink href={withWorkspaceScope("/app/admin/laundry-equipment", scope)}><span>04</span><strong>管理洗衣設備與固定 QR<small>能力、占用與設備狀態</small></strong></AppLink>
            <AppLink href={withWorkspaceScope("/app/admin/notifications", scope)}><span>05</span><strong>通知矩陣與 LINE／Telegram<small>事件、嚴重度與失敗回退</small></strong></AppLink>
            <AppLink href={withWorkspaceScope("/app/admin/bi", scope)}><span>06</span><strong>分析與 BI<small>模型、報表、匯出、摘要與舊單匯入</small></strong></AppLink>
          </div>
        </section>

        </ModuleTabs>
      </section>
    </main>
  );
}
