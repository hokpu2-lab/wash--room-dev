import styles from "./system-guide.module.css";

export default function SystemGuideLoading() {
  return (
    <main className={styles.shell} aria-busy="true" aria-label="系統說明載入中">
      <section className={`${styles.hero} ${styles.loadingCard}`}>
        <div>
          <div className={`${styles.skeleton} ${styles.skeletonEyebrow}`} />
          <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
          <div className={`${styles.skeleton} ${styles.skeletonText}`} />
        </div>
      </section>
      <section className={styles.loadingDocument}>
        <div className={`${styles.skeleton} ${styles.skeletonWide}`} />
        <div className={`${styles.skeleton} ${styles.skeletonText}`} />
        <div className={`${styles.skeleton} ${styles.skeletonText}`} />
        <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
      </section>
    </main>
  );
}
