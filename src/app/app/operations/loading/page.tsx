import { requireAnyRole } from "@/lib/auth/principal";

import styles from "../../workspace.module.css";
import { loadSiteBatches } from "../load-site-batches";
import { LoadingControl } from "./control";

export default async function LoadingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAnyRole(["laundry_worker", "laundry_supervisor"]);
  const { batches, siteId } = await loadSiteBatches(await searchParams, ["awaiting_cart", "in_progress"]);
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="loading-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>CART LOADING</p>
            <h1 id="loading-title">裝回來源車</h1>
            <p className={styles.lede}>最後必要階段完成後，只能掃描該批次來源洗衣車完成裝車。</p>
          </div>
        </header>
        <LoadingControl batches={batches} siteId={siteId} />
      </section>
    </main>
  );
}
