import { ScanCartControl } from "./scan-control";
import styles from "./scan.module.css";

export default function ScanCartPage() {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="scan-title">
        <p className={styles.eyebrow}>CART SCAN</p>
        <h1 id="scan-title">掃描洗衣車</h1>
        <p>同一張車卡：未登入可送單或取件；已登入洗衣員則依車況收單或裝車。請先確認下方流程再繼續。</p>
        <ScanCartControl />
      </section>
    </main>
  );
}
