import { PickupControl } from "./pickup-control";
import styles from "../cart/scan.module.css";

export default function PickupPage() {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="pickup-title">
        <p className={styles.eyebrow}>LAUNDRY PICKUP</p>
        <h1 id="pickup-title">送洗人員領回</h1>
        <p>掃描待取件洗衣車固定 QR 後結案；本頁不顯示歷史洗衣單或其他資料。</p>
        <PickupControl />
      </section>
    </main>
  );
}
