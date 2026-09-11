import { Suspense } from "react";

import { getWorkspaceSnapshot } from "@/lib/analytics/workspace";
import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";

import { LiveQueueFallback } from "../live-queue";
import { SupervisorQueueKpiFallback } from "../workspace-fallbacks";
import { WorkspaceLive } from "../workspace-live";
import styles from "../workspace.module.css";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const query = await searchParams;
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="dashboard-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>ORDERS &amp; BATCHES</p>
            <h1 id="dashboard-title">洗衣單與批次</h1>
            <p className={styles.lede}>依授權範圍搜尋未結案洗衣單、查看選取詳情與目前洗滌批次；需要處理時再進入對應控制點。</p>
          </div>
        </header>
        <Suspense fallback={<><SupervisorQueueKpiFallback /><LiveQueueFallback title="洗衣單清單" /></>}>
          <DashboardLiveData
            query={typeof query.q === "string" ? query.q : undefined}
            page={typeof query.page === "string" && /^\d+$/.test(query.page) ? Number(query.page) : undefined}
            requestedSite={typeof query.site === "string" ? query.site : undefined}
            selectedOrderId={typeof query.order === "string" ? query.order : undefined}
          />
        </Suspense>
      </section>
    </main>
  );
}

async function DashboardLiveData({
  query,
  page,
  requestedSite,
  selectedOrderId,
}: {
  query?: string;
  page?: number;
  requestedSite?: string;
  selectedOrderId?: string;
}) {
  const scope = await resolveWorkspaceScope({ site: requestedSite });
  const snapshot = await getWorkspaceSnapshot({ siteId: scope.siteId ?? undefined, query, page });

  if (!snapshot) {
    return <p className={styles.errorNotice} role="alert">目前無法載入授權範圍內的儀表板。</p>;
  }
  return (
    <WorkspaceLive
      initial={snapshot}
      siteId={scope.siteId ?? undefined}
      query={query}
      page={page}
      mode="queue"
      queueTitle="洗衣單清單"
      variant="supervisor"
      selectedOrderId={selectedOrderId}
    />
  );
}
