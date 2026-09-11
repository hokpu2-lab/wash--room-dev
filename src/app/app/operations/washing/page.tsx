import { Suspense } from "react";

import { requireAnyRole } from "@/lib/auth/principal";

import styles from "../../workspace.module.css";
import { loadSiteBatches } from "../load-site-batches";
import { StartWashingControl } from "./start-control";

export default async function StartWashingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAnyRole(["laundry_worker", "laundry_supervisor"]);
  const query = await searchParams;
  const mode = query.mode === "complete" ? "complete" : "start";
  const focusedBatchId = typeof query.batch === "string" ? query.batch : undefined;
  const { batches, siteId } = await loadSiteBatches(
    query,
    mode === "complete" ? ["in_progress"] : ["not_started"],
  );
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="washing-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>LAUNDRY WASHING</p>
            <h1 id="washing-title">{mode === "complete" ? "結束清洗" : "開始清洗"}</h1>
            <p className={styles.lede}>
              {mode === "complete"
                ? "已帶入這台洗衣機正在執行的單據，確認後結束清洗。"
                : "選擇待清洗批次後開始清洗。標準分鐘只供參考。"}
            </p>
          </div>
        </header>
        <Suspense fallback={null}>
          <StartWashingControl
            batches={batches}
            siteId={siteId}
            mode={mode}
            focusedBatchId={focusedBatchId}
          />
        </Suspense>
      </section>
    </main>
  );
}
