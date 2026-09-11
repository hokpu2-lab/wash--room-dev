import { getWorkspaceSnapshot } from "@/lib/analytics/workspace";
import { requirePrincipal } from "@/lib/auth/principal";
import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";

import styles from "../../workspace.module.css";
import { ControlCenterLive } from "./control-center-live";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ControlCenterPage({ searchParams }: Props) {
  const [scope, query] = await Promise.all([
    resolveWorkspaceScope(),
    searchParams,
  ]);
  await requirePrincipal();
  const site = scope.siteId ?? "";
  const snapshot = await getWorkspaceSnapshot({ siteId: site || undefined, pageSize: 20 });
  const status = typeof query.status === "string" ? query.status : "";

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="control-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>ADVANCED CONTROL POINTS</p>
            <h1 id="control-title">批次控制與重排</h1>
            <p className={styles.lede}>先從授權範圍內的批次開始，可安全還原最後一步，再合併、暫停、記錄異常或提出重排建議。</p>
          </div>
        </header>
        <ControlCenterLive initial={snapshot} site={site} status={status} />
      </section>
    </main>
  );
}
