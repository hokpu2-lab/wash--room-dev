"use client";

import type { WorkspaceBatch } from "@/lib/analytics/workspace-snapshot";

import { AppLink } from "./app-link";
import { batchStatusLabels } from "./status-labels";
import { hrefWithClientScope } from "./workspace-scope-client";
import styles from "./workspace.module.css";

export function SupervisorBatchQueue({ batches, siteId }: { batches: WorkspaceBatch[]; siteId?: string }) {
  const controlCenterHref = hrefWithClientScope("/app/operations/control-center", {
    siteId: siteId ?? null,
    institutionId: null,
  });

  return (
    <section className={styles.quickSection} aria-labelledby="open-batches-title">
      <div className={styles.sectionHeadingRow}>
        <div>
          <p className={styles.eyebrow}>OPEN BATCHES / {String(batches.length).padStart(2, "0")}</p>
          <h2 id="open-batches-title">目前洗滌批次</h2>
        </div>
        <AppLink className={styles.sectionAction} href={controlCenterHref}>
          開啟批次控制中心 →
        </AppLink>
      </div>
      {batches.length === 0 ? (
        <p className={styles.emptyQueue}>目前沒有未完成批次。</p>
      ) : (
        <div className={styles.batchList}>
          {batches.map((batch) => (
            <article key={batch.id} className={styles.batchCard}>
              <div>
                <strong>{batch.orderNumber}</strong>
                <small>{batch.categoryName} · 第 {batch.stageOrder} 階段</small>
              </div>
              <span className={`${styles.badge} ${styles.badgeTeal}`}>
                {batchStatusLabels[batch.status]}
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
