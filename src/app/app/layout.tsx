import type { ReactNode } from "react";
import { Suspense } from "react";
import { connection } from "next/server";
import { getPrincipalState } from "@/lib/auth/principal";

import { AppLink } from "./app-link";
import { LogoutForm } from "./logout-form";
import { NavigationProgress } from "./navigation-progress";
import { NotificationBell } from "./notification-bell";
import { StyleSwitcher } from "./style-switcher";
import { NavigationFallback } from "./workspace-fallbacks";
import { SsoFlashNotice } from "./sso-flash-notice";
import { WorkspaceShellNavigation } from "./workspace-shell";
import styles from "./workspace-shell.module.css";

export default async function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();

  return (
    <div className={styles.workspace} data-workspace-shell data-workspace-style="MX">
      <NavigationProgress />
      <header className={styles.topbar}>
        <AppLink className={styles.brand} href="/app" aria-label="洗衣管理系統工作入口">
          <span>洗</span>
          <strong>洗衣房作業台<small>WASH ROOM OPERATIONS</small></strong>
        </AppLink>
        <div className={styles.topbarTools}>
          <Suspense fallback={null}><WorkspaceNotificationBell /></Suspense>
          <StyleSwitcher />
          <div className={styles.status}><i /> 系統連線中</div>
          <LogoutForm />
        </div>
      </header>
      <aside className={styles.sidebar}>
        <Suspense fallback={<NavigationFallback />}>
          <WorkspaceShellNavigation />
        </Suspense>
      </aside>
        <div className={styles.content}>
          <SsoFlashNotice />
          {children}
        </div>
    </div>
  );
}

async function WorkspaceNotificationBell() {
  const state = await getPrincipalState();
  if (state.kind !== "authorized" || state.principal.memberships.every((membership) => membership.role === "guest")) {
    return null;
  }
  return <NotificationBell />;
}

