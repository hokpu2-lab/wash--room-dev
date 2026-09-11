"use client";

import { Suspense, useEffect, useState } from "react";

import styles from "../../workspace.module.css";
import type { ControlBatch } from "../batch-label";
import { loadWashingControlData } from "./actions";
import { StartWashingControl } from "./start-control";

export function WashingModalContent({ siteId }: { siteId?: string }) {
  const [batches, setBatches] = useState<ControlBatch[] | null>(null);
  const [resolvedSiteId, setResolvedSiteId] = useState<string | undefined>(siteId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWashingControlData(siteId)
      .then((data) => {
        if (cancelled) return;
        setBatches(data.batches);
        setResolvedSiteId(data.siteId);
      })
      .catch(() => {
        if (!cancelled) setError("無法載入開始清洗作業。");
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  if (error) return <p className={styles.errorNotice} role="alert">{error}</p>;
  if (!batches) return <p className={styles.historyModalState}>載入開始清洗…</p>;

  return (
    <section className={styles.panel} aria-labelledby="washing-modal-title">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>LAUNDRY WASHING</p>
          <h1 id="washing-modal-title">開始清洗</h1>
          <p className={styles.lede}>選擇待清洗批次後開始清洗。標準分鐘只供參考。</p>
        </div>
      </header>
      <Suspense fallback={null}>
        <StartWashingControl batches={batches} siteId={resolvedSiteId} />
      </Suspense>
    </section>
  );
}
