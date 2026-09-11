import { EquipmentDispatchControl } from "./dispatch-control";
import styles from "../cart/scan.module.css";

export default function ScanEquipmentPage() {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="equipment-scan-title">
        <p className={styles.eyebrow}>FIXED EQUIPMENT QR</p>
        <h1 id="equipment-scan-title">設備掃碼入口</h1>
        <p>掃描設備固定 QR 後，系統依角色、據點與設備類型導向目前唯一允許的控制點。</p>
        <EquipmentDispatchControl />
      </section>
    </main>
  );
}
