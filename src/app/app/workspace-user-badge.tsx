import { getPrincipalState } from "@/lib/auth/principal";
import styles from "./workspace-shell.module.css";

export async function WorkspaceUserBadge() {
  const state = await getPrincipalState();
  if (state.kind !== "authorized") {
    return null;
  }

  const accountName = state.principal.loginName?.trim() || state.principal.memberships[0]?.scope_name;
  if (!accountName) {
    return null;
  }

  const rawDisplayName = state.principal.displayName?.trim();
  const displayName = rawDisplayName && rawDisplayName !== accountName ? rawDisplayName : null;

  return (
    <div
      className={styles.userBadge}
      title={`目前登入帳號：${accountName}${displayName ? ` (${displayName})` : ""}`}
      aria-label={`目前登入帳號：${accountName}${displayName ? `，顯示名稱：${displayName}` : ""}`}
      data-testid="workspace-user-badge"
    >
      <i className={styles.userIcon} aria-hidden="true">👤</i>
      <span className={styles.userName}>{accountName}</span>
      {displayName ? (
        <span className={styles.userDisplayName}>{`(${displayName})`}</span>
      ) : null}
    </div>
  );
}
