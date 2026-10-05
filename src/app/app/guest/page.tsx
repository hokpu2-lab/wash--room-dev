import { Suspense } from "react";

import { getWorkspaceSnapshot } from "@/lib/analytics/workspace";
import { requireRole } from "@/lib/auth/principal";
import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";

import { LiveQueueFallback } from "../live-queue";
import { WorkspaceLive } from "../workspace-live";
import styles from "../workspace.module.css";

export default async function GuestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="guest-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>READ ONLY</p>
            <h1 id="guest-title">訪客唯讀總覽</h1>
            <p className={styles.lede}>僅能瀏覽授權作業據點的洗衣單與進度；無法執行收單、控制點或帳號管理。</p>
          </div>
        </header>
        <Suspense fallback={<LiveQueueFallback title="洗衣單清單" />}>
          <GuestLiveData
            requestedSite={typeof query.site === "string" ? query.site : undefined}
            query={typeof query.q === "string" ? query.q : undefined}
            page={typeof query.page === "string" && /^\d+$/.test(query.page) ? Number(query.page) : undefined}
          />
        </Suspense>
      </section>
    </main>
  );
}

async function GuestLiveData({ requestedSite, query, page }: { requestedSite?: string; query?: string; page?: number }) {
  const principal = await requireRole("guest");
  const scope = await resolveWorkspaceScope({ site: requestedSite });
  const siteIds = [...new Set(principal.memberships
    .filter((membership) => membership.role === "guest" && membership.operating_site_id)
    .map((membership) => membership.operating_site_id!))];
  const siteId = scope.siteId && siteIds.includes(scope.siteId) ? scope.siteId : siteIds[0];
  const snapshot = await getWorkspaceSnapshot({ siteId, query, page });
  if (!snapshot) return <p className={styles.errorNotice} role="alert">目前無法載入授權據點資料。</p>;
  return <WorkspaceLive initial={snapshot} siteId={siteId} query={query} page={page} readOnly variant="guest" queueTitle="洗衣單清單" />;
}
