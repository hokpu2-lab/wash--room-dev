import { Suspense } from "react";

import { getWorkspaceSnapshot } from "@/lib/analytics/workspace";
import { requireRole } from "@/lib/auth/principal";
import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";

import { AppLink } from "../app-link";
import { LiveQueueFallback } from "../live-queue";
import { WorkspaceLive } from "../workspace-live";
import styles from "../workspace.module.css";

export default async function InstitutionPage({
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
            <p className={styles.eyebrow}>INSTITUTION OVERSIGHT</p>
            <h1 id="workspace-title">送洗機構主管工作台</h1>
            <p className={styles.lede}>只顯示授權送洗機構的洗衣單、進度與待取件資訊；作業控制維持隱藏。</p>
          </div>
          <Suspense fallback={null}>
            <InstitutionScopeBadges />
          </Suspense>
        </header>

        <section className={styles.operationsHero} aria-labelledby="institution-summary-title">
          <div>
            <p className={styles.eyebrow}>READ ONLY SCOPE</p>
            <h2 id="institution-summary-title">本機構洗衣進度</h2>
            <p>實際狀態與預估進度分開顯示；待取件代表設備階段已完成，必須再次掃描車卡才會結案。</p>
          </div>
          <AppLink href="/app/dashboard">查看營運儀表板 <span aria-hidden="true">→</span></AppLink>
        </section>

        <Suspense fallback={<LiveQueueFallback />}>
          <InstitutionLiveData selectedOrderId={typeof query.order === "string" ? query.order : undefined} />
        </Suspense>
      </section>
    </main>
  );
}

async function InstitutionScopeBadges() {
  const principal = await requireRole("institution_supervisor");
  const institutions = principal.memberships.filter((membership) => membership.role === "institution_supervisor");
  return (
    <div className={styles.scopeBadges} aria-label="目前可查閱的送洗機構">
      {institutions.map((membership) => (
        <span key={membership.membership_id}><i aria-hidden="true" /><strong>{membership.scope_name}</strong>{membership.scope_code}</span>
      ))}
    </div>
  );
}

async function InstitutionLiveData({ selectedOrderId }: { selectedOrderId?: string }) {
  await requireRole("institution_supervisor");
  const scope = await resolveWorkspaceScope();
  const snapshot = await getWorkspaceSnapshot({ siteId: scope.siteId ?? undefined });
  return <WorkspaceLive initial={snapshot} siteId={scope.siteId ?? undefined} readOnly variant="institution" selectedOrderId={selectedOrderId} />;
}
