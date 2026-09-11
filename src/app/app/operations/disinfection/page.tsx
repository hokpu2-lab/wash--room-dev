import { requireAnyRole } from "@/lib/auth/principal";

import styles from "../../workspace.module.css";
import { loadSiteBatches } from "../load-site-batches";
import { DisinfectionControl } from "./control";

export default async function DisinfectionPage({
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
      <section className={styles.panel} aria-labelledby="disinfection-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>DISINFECTION CONTROL POINT</p>
            <h1 id="disinfection-title">消毒浸泡</h1>
            <p className={styles.lede}>消毒分類必須先完成消毒鍋浸泡；達標只顯示待確認，不會由計時器自行宣告完成。</p>
          </div>
        </header>
        <DisinfectionControl batches={batches} siteId={siteId} mode={mode} focusedBatchId={focusedBatchId} />
      </section>
    </main>
  );
}
