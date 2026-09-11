import styles from "./workspace.module.css";
import shellStyles from "./workspace-shell.module.css";

export function SupervisorKpiFallback() {
  return (
    <section className={styles.commandRoom} aria-label="營運戰情室載入中">
      <header className={styles.commandHeader}>
        <div><p className={styles.commandEyebrow}>COMMAND ROOM / LIVE</p><h2>營運戰情室</h2><p>正在載入授權作業據點的即時快照。</p></div>
        <div className={styles.commandSignal}><span aria-hidden="true" /><strong>同步中</strong><small>等待第一筆資料</small></div>
      </header>
      <div className={styles.commandKpis} aria-hidden="true">
        <article className={styles.commandKpiPrimary}><span>未結案洗衣單</span><strong>—</strong><small>載入中</small></article>
        <article><span>目前處理中</span><strong>—</strong><small>載入中</small></article>
        <article><span>需要主管介入</span><strong>—</strong><small>載入中</small></article>
        <article><span>待取件</span><strong>—</strong><small>載入中</small></article>
      </div>
    </section>
  );
}

export function SupervisorQueueKpiFallback() {
  return (
    <section className={styles.kpiGrid} aria-label="洗衣單與批次摘要載入中">
      <article className={styles.metricSand}><span>待收件</span><strong>—</strong><small>等待洗衣員收單</small></article>
      <article className={styles.metricSky}><span>待清洗</span><strong>—</strong><small>已建立批次等待設備</small></article>
      <article className={styles.metricMint}><span>處理中</span><strong>—</strong><small>目前正在設備上執行</small></article>
      <article className={styles.metricCoral}><span>待取件</span><strong>—</strong><small>所有必要批次已完成</small></article>
    </section>
  );
}

export function WorkerKpiFallback() {
  return (
    <section className={styles.kpiGrid} aria-label="班別工作指標">
      <article className={styles.metricSand}><span>待收件</span><strong>—</strong><small>等待確認實體洗衣車</small></article>
      <article className={styles.metricSky}><span>可開始</span><strong>—</strong><small>已分類並等待設備</small></article>
      <article className={styles.metricMint}><span>進行中</span><strong>—</strong><small>浸泡、清洗或烘乾</small></article>
      <article className={styles.metricCoral}><span>異常／暫停</span><strong>—</strong><small>需要檢查原因或設備</small></article>
    </section>
  );
}

export function NavigationFallback() {
  return (
    <>
      <div className={shellStyles.searchArea}>
        <div className={shellStyles.searchBox}>
          <span aria-hidden="true">⌕</span>
          <span className={shellStyles.srOnly}>功能選單</span>
        </div>
      </div>
      <nav className={shellStyles.navigation} aria-label="主要功能">
        <section className={shellStyles.navGroup}>
          <p>WORKSPACE</p>
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
        </section>
      </nav>
    </>
  );
}
