"use client";

import { useState } from "react";

import type { WorkspaceSnapshot } from "@/lib/analytics/workspace-snapshot";

import { AppLink } from "./app-link";
import { SupervisorBatchQueue } from "./batch-queue";
import { LiveQueue } from "./live-queue";
import { PendingReceiptModal } from "./operations/receive/pending-receipt-modal";
import { equipmentStatusLabels, equipmentTypeLabels } from "./status-labels";
import { useWorkspaceLive } from "./use-workspace-live";
import { hrefWithClientScope } from "./workspace-scope-client";
import styles from "./workspace.module.css";

type WorkspaceLiveProps = {
  initial: WorkspaceSnapshot | null;
  siteId?: string;
  query?: string;
  page?: number;
  pageSize?: number;
  readOnly?: boolean;
  mode?: "command" | "queue";
  queueTitle?: string;
  selectedOrderId?: string;
  variant: "supervisor" | "worker" | "institution";
};

function WorkerKpis({ snapshot }: { snapshot: WorkspaceSnapshot | null }) {
  return (
    <section className={styles.kpiGrid} aria-label="班別工作指標">
      <article className={styles.metricSand}><span>待收件</span><strong>{snapshot?.dashboard.orders.awaiting_receipt ?? 0}</strong><small>等待確認實體洗衣車</small></article>
      <article className={styles.metricSky}><span>可開始</span><strong>{snapshot?.dashboard.batches.not_started ?? 0}</strong><small>已分類並等待設備</small></article>
      <article className={styles.metricMint}><span>進行中</span><strong>{snapshot?.dashboard.batches.in_progress ?? 0}</strong><small>浸泡、清洗或烘乾</small></article>
      <article className={styles.metricCoral}><span>異常／暫停</span><strong>{snapshot?.dashboard.batches.paused ?? 0}</strong><small>需要檢查原因或設備</small></article>
    </section>
  );
}

function InstitutionKpis({ snapshot }: { snapshot: WorkspaceSnapshot | null }) {
  const dashboard = snapshot?.dashboard;
  return (
    <section className={styles.institutionKpis} aria-label="機構洗衣指標">
      <article><strong>{(dashboard?.orders.awaiting_receipt ?? 0) + (dashboard?.orders.in_process ?? 0) + (dashboard?.orders.ready_for_pickup ?? 0)}</strong><span>未結案洗衣單</span><small>待收件、處理中與待取件</small></article>
      <article><strong>{dashboard?.orders.ready_for_pickup ?? 0}</strong><span>待取件</span><small>可安排送洗人員領回</small></article>
      <article><strong>{dashboard ? Math.round((dashboard.batches.completed / Math.max(dashboard.batches.not_started + dashboard.batches.in_progress + dashboard.batches.paused + dashboard.batches.completed, 1)) * 100) : 0}%</strong><span>整體預估進度</span><small>不等同實際完成或取件</small></article>
    </section>
  );
}

function SupervisorQueueKpis({ snapshot }: { snapshot: WorkspaceSnapshot | null }) {
  return (
    <section className={styles.kpiGrid} aria-label="洗衣單與批次摘要">
      <article className={styles.metricSand}><span>待收件</span><strong>{snapshot?.dashboard.orders.awaiting_receipt ?? 0}</strong><small>送洗人員已送單，等待洗衣員收單</small></article>
      <article className={styles.metricSky}><span>待清洗</span><strong>{snapshot?.dashboard.batches.not_started ?? 0}</strong><small>已建立批次等待設備</small></article>
      <article className={styles.metricMint}><span>處理中</span><strong>{snapshot?.dashboard.batches.in_progress ?? 0}</strong><small>目前正在設備上執行</small></article>
      <article className={styles.metricCoral}><span>待取件</span><strong>{snapshot?.dashboard.orders.ready_for_pickup ?? 0}</strong><small>所有必要批次已完成</small></article>
    </section>
  );
}

function SupervisorCommandRoom({
  snapshot,
  siteId,
  syncedAt,
  liveMode,
}: {
  snapshot: WorkspaceSnapshot | null;
  siteId?: string;
  syncedAt: string | null;
  liveMode: "realtime" | "poll" | "off";
}) {
  const dashboard = snapshot?.dashboard;
  const orders = dashboard?.orders;
  const batches = dashboard?.batches;
  const equipment = snapshot?.equipment ?? [];
  const openOrders = (orders?.awaiting_receipt ?? 0) + (orders?.in_process ?? 0) + (orders?.ready_for_pickup ?? 0);
  const equipmentIssues = equipment.filter((item) => item.status === "abnormal" || item.status === "maintenance").length;
  const actionCount = (batches?.paused ?? 0) + (orders?.awaiting_receipt ?? 0) + equipmentIssues;
  const liveLabel = liveMode === "realtime" ? "即時連線" : liveMode === "poll" ? "定時同步" : "伺服器快照";
  const equipmentHref = hrefWithClientScope("/app/admin/laundry-equipment", { siteId: siteId ?? null, institutionId: null });
  const [pendingReceiptModalOpen, setPendingReceiptModalOpen] = useState(false);

  return (
    <section className={styles.commandRoom} aria-labelledby="command-room-title">
      <header className={styles.commandHeader}>
        <div>
          <p className={styles.commandEyebrow}>COMMAND ROOM / LIVE</p>
          <h2 id="command-room-title">營運戰情室</h2>
          <p>先看風險，再看佇列；所有數字都來自目前授權作業據點的即時快照。</p>
        </div>
        <div className={styles.commandSignal} aria-label={`資料狀態：${liveLabel}`}>
          <span aria-hidden="true" />
          <strong>{liveLabel}</strong>
          <small>{syncedAt ? `最後同步 ${new Date(syncedAt).toLocaleTimeString("zh-Hant")}` : "等待第一筆同步"}</small>
        </div>
      </header>

      <div className={styles.commandKpis} aria-label="戰情室核心指標">
        <article className={styles.commandKpiPrimary}><span>未結案洗衣單</span><strong>{openOrders}</strong><small>待收件、處理中與待取件</small></article>
        <article><span>目前處理中</span><strong>{orders?.in_process ?? "—"}</strong><small>{batches?.in_progress ?? 0} 個批次正在設備上</small></article>
        <article className={actionCount ? styles.commandKpiAlert : styles.commandKpiGood}><span>需要主管介入</span><strong>{actionCount}</strong><small>{batches?.paused ?? 0} 暫停 · {equipmentIssues} 設備異常</small></article>
        <article><span>待取件</span><strong>{orders?.ready_for_pickup ?? "—"}</strong><small>送洗人員掃車 QR 後結案</small></article>
      </div>

      <div className={styles.commandGrid}>
        <section className={styles.commandPanel} aria-labelledby="command-priority-title">
          <div className={styles.commandPanelHead}><div><p className={styles.eyebrow}>PRIORITY QUEUE</p><h3 id="command-priority-title">現在要處理</h3></div><span>{actionCount ? `${actionCount} 件` : "CLEAR"}</span></div>
          <div className={styles.priorityList}>
            {batches?.paused ? <AppLink href="/app/operations/control-center#tab=incidents" className={`${styles.priorityItem} ${styles.priorityAlert}`}><i aria-hidden="true" /><span><strong>暫停批次</strong><small>檢查設備或異常原因，確認是否恢復</small></span><b>{batches.paused}</b></AppLink> : null}
            {orders?.awaiting_receipt ? (
              <button
                type="button"
                onClick={() => setPendingReceiptModalOpen(true)}
                className={`${styles.priorityItem} ${styles.priorityWarm}`}
                style={{
                  background: "none",
                  border: "none",
                  textAlign: "left",
                  width: "100%",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  padding: 0,
                }}
              >
                <i aria-hidden="true" />
                <span>
                  <strong>待洗衣員收單</strong>
                  <small>點擊查看待收單據並載入資料</small>
                </span>
                <b>{orders.awaiting_receipt}</b>
              </button>
            ) : null}
            {equipmentIssues ? <AppLink href={equipmentHref} className={`${styles.priorityItem} ${styles.priorityAlert}`}><i aria-hidden="true" /><span><strong>設備狀態需確認</strong><small>異常或維修中的設備</small></span><b>{equipmentIssues}</b></AppLink> : null}
            {!actionCount ? <div className={styles.priorityClear}><span aria-hidden="true">✓</span><strong>目前沒有需要主管介入的項目</strong><small>維持目前作業節奏，持續觀察待取件佇列。</small></div> : null}
          </div>
        </section>

        <section className={styles.commandPanel} aria-labelledby="command-pipeline-title">
          <div className={styles.commandPanelHead}><div><p className={styles.eyebrow}>FLOW RADAR</p><h3 id="command-pipeline-title">流程雷達</h3></div><span>ORDERS</span></div>
          <div className={styles.pipelineList}>
            <PipelineRow label="待收件" value={orders?.awaiting_receipt ?? 0} total={Math.max(openOrders, 1)} tone="sand" />
            <PipelineRow label="處理中" value={orders?.in_process ?? 0} total={Math.max(openOrders, 1)} tone="sky" />
            <PipelineRow label="待取件" value={orders?.ready_for_pickup ?? 0} total={Math.max(openOrders, 1)} tone="mint" />
            <PipelineRow label="已取件" value={orders?.picked_up ?? 0} total={Math.max(orders?.picked_up ?? 0, 1)} tone="slate" />
          </div>
        </section>
      </div>

      <section className={styles.commandEquipment} aria-labelledby="command-equipment-title">
        <div className={styles.commandPanelHead}><div><p className={styles.eyebrow}>EQUIPMENT RADAR</p><h3 id="command-equipment-title">設備雷達</h3></div><span>{equipment.length} 台授權設備</span></div>
        <div className={styles.commandEquipmentGrid}>
          {equipment.slice(0, 8).map((item) => {
            const state = item.occupied ? "使用中" : equipmentStatusLabels[item.status];
            const stateClass = item.occupied ? styles.equipmentBusy : item.status === "normal" ? styles.equipmentReady : styles.equipmentIssue;
            return <div key={item.id} className={styles.commandEquipmentItem}><span className={stateClass} aria-hidden="true" /><div><strong>{item.name}</strong><small>{equipmentTypeLabels[item.equipmentType]}</small></div><em>{state}</em></div>;
          })}
          {!equipment.length ? <p className={styles.emptyQueue}>目前沒有可顯示的設備快照。</p> : null}
        </div>
      </section>

      <PendingReceiptModal
        isOpen={pendingReceiptModalOpen}
        onClose={() => setPendingReceiptModalOpen(false)}
        siteId={siteId}
      />
    </section>
  );
}

function PipelineRow({ label, value, total, tone }: { label: string; value: number; total: number; tone: "sand" | "sky" | "mint" | "slate" }) {
  const percentage = Math.min(Math.round((value / total) * 100), 100);
  return <div className={styles.pipelineRow}><span>{label}</span><div className={styles.pipelineTrack}><i className={`${styles[`pipeline${tone[0].toUpperCase()}${tone.slice(1)}`]}`} style={{ width: `${value ? Math.max(percentage, 8) : 0}%` }} /></div><strong>{value}</strong></div>;
}

export function WorkspaceLive({
  initial,
  siteId,
  query,
  page,
  pageSize,
  readOnly = false,
  mode = "queue",
  queueTitle = "洗衣單流程",
  selectedOrderId,
  variant,
}: WorkspaceLiveProps) {
  const { snapshot, syncedAt, liveMode } = useWorkspaceLive(initial, {
    siteId,
    query,
    page,
    pageSize,
  });
  const [selectedOrderNumber, setSelectedOrderNumber] = useState<string | null>(null);

  return (
    <>
      {variant === "worker" ? <WorkerKpis snapshot={snapshot} /> : null}
      {variant === "supervisor" && mode === "queue" ? <SupervisorQueueKpis snapshot={snapshot} /> : null}
      {variant === "supervisor" && mode === "command" ? <SupervisorCommandRoom snapshot={snapshot} siteId={siteId} syncedAt={syncedAt} liveMode={liveMode} /> : null}
      {variant === "institution" ? <InstitutionKpis snapshot={snapshot} /> : null}
      {mode !== "command" ? <p className={styles.hint}>
        {liveMode === "realtime" ? "即時更新" : liveMode === "poll" ? "定時更新" : "伺服器快照"}
        {syncedAt ? ` · 最後同步 ${new Date(syncedAt).toLocaleTimeString("zh-Hant")}` : ""}
      </p> : null}
      {mode !== "command" ? <LiveQueue
          orders={snapshot?.orders ?? []}
          orderDetails={snapshot?.orderDetails ?? []}
          equipment={variant === "supervisor" ? [] : snapshot?.equipment ?? []}
          query={snapshot?.query ?? query ?? ""}
          page={snapshot?.page ?? 1}
          pageSize={snapshot?.pageSize ?? 20}
          total={snapshot?.orderTotal ?? 0}
          siteId={siteId}
          readOnly={readOnly}
          title={queueTitle}
          selectedOrderId={selectedOrderId}
          onSelectOrder={(_id, orderNum) => setSelectedOrderNumber(orderNum)}
        /> : null}
      {variant === "supervisor" && mode === "queue" ? (
        <SupervisorBatchQueue
          batches={snapshot?.batches ?? []}
          siteId={siteId}
          selectedOrderNumber={selectedOrderNumber}
        />
      ) : null}
    </>
  );
}
