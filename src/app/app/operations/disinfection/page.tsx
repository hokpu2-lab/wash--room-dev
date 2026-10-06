import { Suspense } from "react";

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
  const selectedCartNumber = typeof query.cart === "string" ? query.cart : undefined;
  const selectedOrderNumber = typeof query.order === "string" ? query.order : undefined;
  const selectedInstitutionName = typeof query.institution === "string" ? query.institution : undefined;
  const { batches, siteId, equipmentList } = await loadSiteBatches(
    query,
    mode === "complete" ? ["in_progress"] : ["not_started"],
  );
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="disinfection-title">
        <Suspense fallback={null}>
          <DisinfectionControl
            batches={batches}
            siteId={siteId}
            mode={mode}
            focusedBatchId={focusedBatchId}
            availableEquipment={equipmentList}
            selectedCartNumber={selectedCartNumber}
            selectedOrderNumber={selectedOrderNumber}
            selectedInstitutionName={selectedInstitutionName}
          />
        </Suspense>
      </section>
    </main>
  );
}
