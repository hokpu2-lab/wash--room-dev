"use client";

import { useEffect, useRef, useState } from "react";

import type {
  LaundryOrderHistoryDetail,
  LaundryOrderHistoryEvent,
  LaundryOrderHistoryItem,
} from "@/lib/analytics/order-history-model";
import type { WorkspaceBatchDetail } from "@/lib/analytics/workspace-snapshot";

import { LaundryOrderFlow3D } from "./laundry-order-flow-3d";
import { batchStatusLabels, equipmentTypeLabels } from "./status-labels";
import styles from "./workspace.module.css";

const eventLabels: Record<string, string> = {
  laundry_order_created_from_cart_qr: "建立洗衣單",
  laundry_order_received: "收單並完成分類",
  laundry_batch_disinfection_started: "開始消毒浸泡",
  laundry_batch_disinfection_completed_washing_started: "完成消毒並開始清洗",
  laundry_batch_washing_started: "開始清洗",
  laundry_batch_washing_completed: "完成清洗",
  laundry_batch_washing_completed_drying_started: "完成清洗並開始烘乾",
  laundry_batch_drying_completed: "完成烘乾",
  laundry_batch_loaded_to_source_cart: "裝回來源車",
  laundry_order_picked_up: "完成取件",
  laundry_batch_stage_paused: "暫停處理",
  laundry_batch_stage_resumed: "恢復處理",
  laundry_batch_incident_recorded: "回報異常",
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function eventLabel(event: LaundryOrderHistoryEvent) {
  return eventLabels[event.action] ?? event.action.replaceAll("_", " ");
}

function firstEventTime(events: LaundryOrderHistoryEvent[], action: string) {
  return events.find((event) => event.action === action)?.occurredAt ?? null;
}

function lastEventTime(events: LaundryOrderHistoryEvent[], actions: string[]) {
  return events
    .filter((event) => actions.includes(event.action))
    .at(-1)?.occurredAt ?? null;
}

function batchStatusClass(status: WorkspaceBatchDetail["status"]) {
  if (status === "paused") return styles.badgeWarm;
  if (status === "completed" || status === "loaded") return styles.badgeGreen;
  return styles.badgeTeal;
}

function HistoryBatch({ batch }: { batch: WorkspaceBatchDetail }) {
  return (
    <article className={styles.historyBatchCard} aria-label={`批次 ${batch.batchSequence} ${batch.categoryName}`}>
      <header className={styles.historyBatchHeader}>
        <div>
          <h3>B-{String(batch.batchSequence).padStart(3, "0")} · {batch.categoryName}</h3>
          <p>{batch.procedureName} v{batch.procedureVersion}</p>
        </div>
        <span className={`${styles.badge} ${batchStatusClass(batch.status)}`}>
          {batchStatusLabels[batch.status] ?? batch.status}
        </span>
      </header>

      {batch.stages.length ? (
        <ol className={styles.historyStageList} aria-label="批次程序階段">
          {batch.stages.map((stage) => (
            <li key={stage.stageOrder} className={stage.state === "completed" ? styles.historyStageCompleted : undefined}>
              <span>{stage.state === "completed" ? "✓" : stage.stageOrder}</span>
              <div>
                <strong>{stage.name}</strong>
                <small>
                  {stage.state === "completed" ? "已完成" : stage.state === "active" ? "處理中" : "等待控制點"}
                  {stage.equipmentType !== "manual" && stage.equipmentType !== "cart" ? ` · ${equipmentTypeLabels[stage.equipmentType]}` : ""}
                </small>
                <small>
                  {stage.startedAt ? `開始 ${formatDateTime(stage.startedAt)}` : "尚無開始時間"}
                  {stage.completedAt ? ` · 完成 ${formatDateTime(stage.completedAt)}` : ""}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.historyBatchProgress}>
        <span>程序預估進度</span>
        <strong>{Math.round(batch.progress.overallProgressPercent)}%</strong>
        <progress max="100" value={batch.progress.overallProgressPercent} aria-label={`${batch.categoryName} 程序進度`} />
      </div>
    </article>
  );
}

function HistoryModal({
  item,
  detail,
  loading,
  error,
  onClose,
}: {
  item: LaundryOrderHistoryItem;
  detail: LaundryOrderHistoryDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className={styles.historyModalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={styles.historyModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-detail-title"
      >
        <header className={styles.historyModalHeader}>
          <div>
            <p className={styles.eyebrow}>ORDER HISTORY</p>
            <h2 id="history-detail-title">洗衣單整體歷程</h2>
            <p>{item.orderNumber}</p>
          </div>
          <button ref={closeButtonRef} className={styles.historyModalClose} type="button" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </header>

        {loading ? <p className={styles.historyModalState}>載入整體歷程中…</p> : null}
        {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
        {detail ? (
          <div className={styles.historyModalContent}>
            <dl className={styles.historyMetaGrid}>
              <div><dt>送洗機構</dt><dd>{detail.order.institutionName}（{detail.order.institutionCode}）</dd></div>
              <div><dt>洗衣車</dt><dd>{detail.order.cartNumber}</dd></div>
              <div><dt>作業據點</dt><dd>{detail.order.siteName}（{detail.order.siteCode}）</dd></div>
              <div><dt>目前狀態</dt><dd><span className={`${styles.badge} ${styles.badgeGreen}`}>已取件</span></dd></div>
              <div><dt>送單時間</dt><dd>{formatDateTime(detail.order.createdAt)}</dd></div>
              <div><dt>取件時間</dt><dd>{formatDateTime(detail.order.closedAt)}</dd></div>
            </dl>

            <LaundryOrderFlow3D
              animateAllNodes
              orderStatus={detail.order.status}
              batches={detail.batches}
              orderCreatedAt={detail.order.createdAt}
              orderReceivedAt={firstEventTime(detail.events, "laundry_order_received")}
              orderReadyAt={lastEventTime(detail.events, [
                "laundry_batch_loaded_to_source_cart",
                "laundry_batch_completed_without_source_loading",
              ])}
              orderClosedAt={detail.order.closedAt}
            />

            <section className={styles.historyModalSection} aria-labelledby="history-events-title">
              <div className={styles.historyModalSectionHeading}>
                <div>
                  <p className={styles.eyebrow}>AUDIT TIMELINE</p>
                  <h3 id="history-events-title">流程與操作歷程</h3>
                </div>
                <span>{detail.events.length} 筆已完成紀錄</span>
              </div>
              {detail.events.length ? (
                <ol className={styles.historyEventList}>
                  {detail.events.map((event) => (
                    <li key={event.id}>
                      <span className={styles.historyEventMarker} aria-hidden="true">✓</span>
                      <div>
                        <strong>{eventLabel(event)}</strong>
                        <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
                        {event.equipmentName ? <small>設備：{event.equipmentName}</small> : null}
                        {event.reason ? <small>{event.reason}</small> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.historyModalState}>此洗衣單目前沒有可顯示的稽核事件。</p>
              )}
            </section>

            <section className={styles.historyModalSection} aria-labelledby="history-batches-title">
              <div className={styles.historyModalSectionHeading}>
                <div>
                  <p className={styles.eyebrow}>BATCH DETAILS</p>
                  <h3 id="history-batches-title">批次與程序明細</h3>
                </div>
                <span>{detail.batches.length} 個批次</span>
              </div>
              {detail.batches.length ? (
                <div className={styles.historyBatchList}>
                  {detail.batches.map((batch) => <HistoryBatch key={batch.id} batch={batch} />)}
                </div>
              ) : (
                <p className={styles.historyModalState}>此洗衣單沒有可顯示的批次明細。</p>
              )}
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function HistoryResults({ items }: { items: LaundryOrderHistoryItem[] }) {
  const [selectedItem, setSelectedItem] = useState<LaundryOrderHistoryItem | null>(null);
  const [detail, setDetail] = useState<LaundryOrderHistoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => () => requestController.current?.abort(), []);

  async function openHistory(item: LaundryOrderHistoryItem) {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setSelectedItem(item);
    setDetail(null);
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/app/laundry-orders/${encodeURIComponent(item.id)}/history`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("history request failed");
      const payload = await response.json() as LaundryOrderHistoryDetail;
      if (controller.signal.aborted) return;
      setDetail(payload);
    } catch (caughtError) {
      if (controller.signal.aborted) return;
      setError(caughtError instanceof Error && caughtError.message === "history request failed"
        ? "目前無法載入這張洗衣單的完整歷程。"
        : "載入歷程時發生錯誤，請稍後再試。");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function closeHistory() {
    requestController.current?.abort();
    requestController.current = null;
    setSelectedItem(null);
    setDetail(null);
    setLoading(false);
    setError(null);
  }

  return (
    <>
      {items.length === 0 ? (
        <p className={styles.historyEmpty}>此期間沒有符合條件的已取件洗衣單。</p>
      ) : (
        <div className={styles.tableScroller} data-testid="history-results">
          <table>
            <thead>
              <tr>
                <th scope="col">洗衣單號</th>
                <th scope="col">送洗機構</th>
                <th scope="col">洗衣車</th>
                <th scope="col">送單時間</th>
                <th scope="col">取件時間</th>
                <th scope="col">狀態</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    <button
                      className={styles.historyOrderButton}
                      type="button"
                      aria-label={`查看 ${item.orderNumber} 整體歷程`}
                      onClick={() => void openHistory(item)}
                    >
                      {item.orderNumber}
                    </button>
                  </th>
                  <td>{item.institutionName} <span className={styles.tableSubtle}>({item.institutionCode})</span></td>
                  <td>{item.cartNumber}</td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{formatDateTime(item.closedAt)}</td>
                  <td><span className={`${styles.badge} ${styles.badgeGreen}`}>已取件</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedItem ? (
        <HistoryModal
          item={selectedItem}
          detail={detail}
          loading={loading}
          error={error}
          onClose={closeHistory}
        />
      ) : null}
    </>
  );
}
