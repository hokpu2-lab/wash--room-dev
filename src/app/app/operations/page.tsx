import { Suspense } from "react";

import { getWorkspaceSnapshot } from "@/lib/analytics/workspace";
import { isSiteRole } from "@/lib/auth/access-role";
import { requireAnyRole } from "@/lib/auth/principal";
import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";

import { AppLink } from "../app-link";
import { LiveQueueFallback } from "../live-queue";
import { ModuleTabs } from "../module-tabs";
import { WorkspaceLive } from "../workspace-live";
import { WorkerKpiFallback } from "../workspace-fallbacks";
import styles from "../workspace.module.css";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="workspace-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>SHIFT OPERATIONS</p>
            <h1 id="workspace-title">洗衣員作業台</h1>
            <p className={styles.lede}>從實體車輛與設備開始，每次掃碼只呈現目前允許執行的控制點。</p>
          </div>
          <Suspense fallback={null}>
            <WorkerScopeBadges />
          </Suspense>
        </header>

        <ModuleTabs
          ariaLabel="洗衣員工作台分類"
          storageKey="operations-home"
          tabs={[
            { id: "live", label: "目前作業", description: "KPI、待辦與即時佇列" },
            { id: "controls", label: "作業控制點", description: "收單、洗滌與更正" },
          ]}
        >
        <section aria-label="目前作業總覽">
        <section className={styles.operationsHero} aria-labelledby="shift-focus-title">
          <div>
            <p className={styles.eyebrow}>NEXT CONTROL POINT</p>
            <h2 id="shift-focus-title">掃描、確認、繼續</h2>
            <p>先核對洗衣車或設備，再選擇批次並確認；系統會阻擋跨據點、不相容或已占用的設備。</p>
          </div>
          <AppLink href="/app/operations/receive">開始收單 <span aria-hidden="true">→</span></AppLink>
        </section>

        <Suspense fallback={<><WorkerKpiFallback /><LiveQueueFallback /></>}>
          <WorkerLiveData
            query={typeof query.q === "string" ? query.q : undefined}
            page={typeof query.page === "string" && /^\d+$/.test(query.page) ? Number(query.page) : undefined}
          />
        </Suspense>
        </section>

        <section className={styles.quickSection} aria-labelledby="operation-controls-title">
          <div className={styles.sectionHeadingRow}>
            <div><p className={styles.eyebrow}>CONTROL POINTS</p><h2 id="operation-controls-title">作業控制點</h2></div>
            <p>依實體流程操作，不以預估進度代替完成確認。</p>
          </div>
          <div className={styles.quickGrid}>
            <AppLink href="/app/operations/receive"><span>01</span><strong>收單與分類<small>掃洗衣車、核對送洗機構並建立批次</small></strong></AppLink>
            <AppLink href="/app/operations/disinfection"><span>02</span><strong>消毒浸泡<small>消毒分類在清洗前的必要階段</small></strong></AppLink>
            <AppLink href="/app/operations/washing"><span>03</span><strong>開始清洗<small>掃描相容且可用的洗衣機</small></strong></AppLink>
            <AppLink href="/app/operations/drying"><span>04</span><strong>清洗完成與烘乾<small>原子完成清洗並啟動烘衣機</small></strong></AppLink>
            <AppLink href="/app/operations/split"><span>05</span><strong>拆分必要批次<small>依分類、容量與程序拆分</small></strong></AppLink>
            <AppLink href="/app/operations/control-center"><span>06</span><strong>批次控制與重排<small>異常、暫停、合併與重排建議</small></strong></AppLink>
          </div>
        </section>
        </ModuleTabs>
      </section>
    </main>
  );
}

async function WorkerScopeBadges() {
  const principal = await requireAnyRole(["laundry_worker", "laundry_supervisor"]);
  const sites = principal.memberships.filter(
    (membership) => isSiteRole(membership.role),
  );
  return (
    <div className={styles.scopeBadges} aria-label="目前可執行作業的授權據點">
      {sites.map((membership) => (
        <span key={membership.membership_id}><i aria-hidden="true" /><strong>{membership.scope_name}</strong>{membership.scope_code}</span>
      ))}
    </div>
  );
}

async function WorkerLiveData({ query, page }: { query?: string; page?: number }) {
  await requireAnyRole(["laundry_worker", "laundry_supervisor"]);
  const scope = await resolveWorkspaceScope();
  const snapshot = await getWorkspaceSnapshot({ siteId: scope.siteId ?? undefined, query, page });
  return (
    <WorkspaceLive
      initial={snapshot}
      siteId={scope.siteId ?? undefined}
      query={query}
      page={page}
      variant="worker"
    />
  );
}
