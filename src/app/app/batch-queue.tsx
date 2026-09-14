"use client";

import type { WorkspaceBatch } from "@/lib/analytics/workspace-snapshot";

import { AppLink } from "./app-link";
import { batchStatusLabels } from "./status-labels";
import { hrefWithClientScope } from "./workspace-scope-client";
import styles from "./workspace.module.css";

export function SupervisorBatchQueue({
  batches,
  siteId,
  selectedOrderNumber,
}: {
  batches: WorkspaceBatch[];
  siteId?: string;
  selectedOrderNumber?: string | null;
}) {
  const controlCenterHref = hrefWithClientScope("/app/operations/control-center", {
    siteId: siteId ?? null,
    institutionId: null,
  });

  const matchingCount = selectedOrderNumber
    ? batches.filter((b) => b.orderNumber === selectedOrderNumber).length
    : 0;

  return (
    <section className={styles.quickSection} aria-labelledby="open-batches-title">
      <div className={styles.sectionHeadingRow}>
        <div>
          <p className={styles.eyebrow}>OPEN BATCHES / {String(batches.length).padStart(2, "0")}</p>
          <h2 id="open-batches-title">目前洗滌批次</h2>
          {selectedOrderNumber ? (
            <p className={styles.batchQueueFilterHint}>
              {matchingCount > 0
                ? `★ 單號 ${selectedOrderNumber} 共有 ${matchingCount} 個執行中洗滌批次（已標記高亮）`
                : `ℹ 單號 ${selectedOrderNumber} 目前尚未建立洗滌批次（待洗衣員收單）`}
            </p>
          ) : null}
        </div>
        <AppLink className={styles.sectionAction} href={controlCenterHref}>
          開啟批次控制中心 →
        </AppLink>
      </div>
      {batches.length === 0 ? (
        <p className={styles.emptyQueue}>目前沒有未完成批次。</p>
      ) : (
        <div className={styles.batchList}>
          {batches.map((batch) => {
            const isSelectedOrderBatch = Boolean(selectedOrderNumber && batch.orderNumber === selectedOrderNumber);
            return (
              <article
                key={batch.id}
                className={isSelectedOrderBatch ? `${styles.batchCard} ${styles.batchCardActive}` : styles.batchCard}
              >
                <div>
                  <strong>
                    {batch.orderNumber}
                    {isSelectedOrderBatch ? <em className={styles.batchActiveTag}>★ 此單批次</em> : null}
                  </strong>
                  <small>{batch.categoryName} · 第 {batch.stageOrder} 階段</small>
                </div>
                <span className={`${styles.badge} ${styles.badgeTeal}`}>
                  {batchStatusLabels[batch.status]}
                </span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
