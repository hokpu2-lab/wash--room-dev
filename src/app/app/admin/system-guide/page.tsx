import { requireAnyRole } from "@/lib/auth/principal";

import styles from "../../workspace.module.css";
import { SystemGuideViewer } from "./system-guide-viewer";

export default async function SystemGuidePage() {
  await requireAnyRole(["system_administrator", "laundry_supervisor"]);

  return (
    <main className={styles.shell}>
      <SystemGuideViewer />
    </main>
  );
}

