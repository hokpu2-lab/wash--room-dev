import { signOut } from "./actions";
import { LogoutSubmit } from "./logout-submit";
import styles from "./workspace.module.css";

export function LogoutForm() {
  return (
    <form action={signOut} className={styles.logoutForm}>
      <LogoutSubmit />
    </form>
  );
}
