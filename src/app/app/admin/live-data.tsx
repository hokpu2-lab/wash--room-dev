import { getWorkspaceSnapshot } from "@/lib/analytics/workspace";
import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole } from "@/lib/auth/principal";

import { WorkspaceLive } from "../workspace-live";
import styles from "../workspace.module.css";


export async function AdminScopeBadges() {
  const principal = await requireRole("laundry_supervisor");
  const sites = principal.memberships.filter((membership) => isLaundrySupervisorRole(membership.role));
  return (
    <div className={styles.scopeBadges} aria-label="目前可管理的作業據點">
      {sites.map((membership) => (
        <span key={membership.membership_id}>
          <i aria-hidden="true" />
          <strong>{membership.scope_name}</strong>
          {membership.scope_code}
        </span>
      ))}
    </div>
  );
}

export async function AdminLiveData({
  siteId,
}: {
  siteId?: string;
} = {}) {
  const principal = await requireRole("laundry_supervisor");
  const selectedSiteId =
    siteId &&
    principal.memberships.some(
      (membership) => isLaundrySupervisorRole(membership.role) && membership.operating_site_id === siteId,
    )
      ? siteId
      : undefined;
  const snapshot = await getWorkspaceSnapshot({
    siteId: selectedSiteId,
    pageSize: 1,
  });

  return (
    <WorkspaceLive
      initial={snapshot}
      siteId={selectedSiteId}
      mode="command"
      variant="supervisor"
    />
  );
}
