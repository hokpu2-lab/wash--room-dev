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

  return (
    <div
      className={styles.userBadge}
      title={`目前登入帳號：${accountName}`}
      aria-label={`目前登入帳號：${accountName}`}
      data-testid="workspace-user-badge"
    >
      <i className={styles.userIcon} aria-hidden="true">👤</i>
      <span className={styles.userName}>{accountName}</span>
    </div>
  );
}
