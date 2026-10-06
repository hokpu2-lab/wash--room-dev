import { Suspense } from "react";

import { requireAnyRole } from "@/lib/auth/principal";

import styles from "../../workspace.module.css";
import { loadSiteBatches } from "../load-site-batches";
import { DryingControl } from "./control";

export default async function DryingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAnyRole(["laundry_worker", "laundry_supervisor"]);
  const query = await searchParams;
  const mode = query.mode === "complete" ? "complete" : "start";
  const focusedBatchId = typeof query.batch === "string" ? query.batch : undefined;
  const selectedCartNumber = typeof query.cart === "string" ? query.cart : undefined;
  const selectedOrderNumber = typeof query.order === "string" ? query.order : undefined;
  const selectedInstitutionName = typeof query.institution === "string" ? query.institution : undefined;
  const { batches, siteId } = await loadSiteBatches(
    query,
    mode === "complete" ? ["in_progress"] : ["not_started"],
  );
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="drying-title">
        <Suspense fallback={null}>
          <DryingControl
            batches={batches}
            siteId={siteId}
            mode={mode}
            focusedBatchId={focusedBatchId}
            selectedCartNumber={selectedCartNumber}
            selectedOrderNumber={selectedOrderNumber}
            selectedInstitutionName={selectedInstitutionName}
          />
        </Suspense>
      </section>
    </main>
  );
}
