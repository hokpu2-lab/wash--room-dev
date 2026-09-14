"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  WorkspaceBatchDetail,
  WorkspaceEquipment,
  WorkspaceOrder,
  WorkspaceOrderDetail,
} from "@/lib/analytics/workspace-snapshot";

import { AppLink } from "./app-link";
import { LaundryOrderFlow3D } from "./laundry-order-flow-3d";
import { WashingModalContent } from "./operations/washing/modal-content";
import {
  batchStatusLabels,
  equipmentStatusLabels,
  equipmentTypeLabels,
  orderStatusLabel,
} from "./status-labels";
import { hrefWithClientScope } from "./workspace-scope-client";
import styles from "./workspace.module.css";

const orderBadgeClass = {
  awaiting_receipt: styles.badgeNeutral,
  awaiting_cleaning: styles.badgeBlue,
  in_process: styles.badgeTeal,
  ready_for_pickup: styles.badgeGreen,
  picked_up: styles.badgeNeutral,
} as const;

type LiveQueueProps = {
  orders: WorkspaceOrder[];
  orderDetails?: WorkspaceOrderDetail[];
  equipment?: WorkspaceEquipment[];
  selectedOrderId?: string;
  readOnly?: boolean;
  query?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  siteId?: string;
  title?: string;
  onSelectOrder?: (orderId: string, orderNumber: string) => void;
};

export function LiveQueueFallback({ title = "洗衣單流程" }: { title?: string } = {}) {
  return (
    <section className={styles.contentGrid} aria-labelledby="live-queue-title">
      <div className={styles.queuePanel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>LIVE QUEUE</p>
            <h2 id="live-queue-title">{title}</h2>
          </div>
        </div>
        <div className={styles.skeletonStack} aria-hidden="true">
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLine} />
        </div>
      </div>
    </section>
  );
}

export function LiveQueue({
  orders,
  orderDetails = [],
  equipment = [],
  selectedOrderId,
  readOnly = false,
  query = "",
  page = 1,
  pageSize = 20,
  total = orders.length,
  siteId,
  title = "洗衣單流程",
  onSelectOrder,
}: LiveQueueProps) {
  const [selectedId, setSelectedId] = useState<string | null>(selectedOrderId ?? orders[0]?.id ?? null);
  const [detailOpen, setDetailOpen] = useState(false);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [fetchedDetail, setFetchedDetail] = useState<WorkspaceOrderDetail | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (selectedOrderId) setSelectedId(selectedOrderId);
  }, [selectedOrderId]);
  const activeSelectedId = selectedId && orders.some((order) => order.id === selectedId)
    ? selectedId
    : selectedOrderId && orders.some((order) => order.id === selectedOrderId)
      ? selectedOrderId
      : selectedId
        ?? orders[0]?.id
        ?? null;
  const selected = orders.find((order) => order.id === activeSelectedId) ?? null;
  const selectedDetail = selected
    ? orderDetails.find((detail) => detail.orderId === selected.id)
      ?? (fetchedDetail?.orderId === selected.id ? fetchedDetail : null)
    : fetchedDetail?.orderId === activeSelectedId ? fetchedDetail : null;

  const handleSelectOrder = (order: WorkspaceOrder) => {
    setSelectedId(order.id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("order", order.id);
      window.history.replaceState(null, "", url.toString());
    }
    onSelectOrder?.(order.id, order.orderNumber);
  };

  const handleCopyOrderNumber = (orderNumber: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(orderNumber).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  useEffect(() => {
    if (selected) {
      onSelectOrder?.(selected.id, selected.orderNumber);
    }
  }, [selected?.id, selected?.orderNumber, onSelectOrder]);

  useEffect(() => {
    if (!activeSelectedId) {
      setFetchedDetail(null);
      return;
    }
    if (orderDetails.some((detail) => detail.orderId === activeSelectedId)) {
      setFetchedDetail(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/app/laundry-orders/${activeSelectedId}/detail`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((detail: WorkspaceOrderDetail | null) => {
        if (!cancelled && detail?.orderId === activeSelectedId) setFetchedDetail(detail);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSelectedId, orderDetails]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const searchHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (nextPage > 1) params.set("page", String(nextPage));
    if (siteId) params.set("site", siteId);
    if (selectedOrderId) params.set("order", selectedOrderId);
    const encoded = params.toString();
    return encoded ? `?${encoded}` : "?";
  };

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!detailOpen) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDetail, detailOpen]);

  return (
    <section className={styles.contentGrid} aria-labelledby="live-queue-title">
      <div className={styles.queuePanel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.eyebrow}>LIVE QUEUE / {String(total).padStart(2, "0")}</p>
            <h2 id="live-queue-title">{title}</h2>
          </div>
          <form className={styles.queueSearch} method="get">
            {siteId ? <input type="hidden" name="site" value={siteId} /> : null}
            <label>
              <span className={styles.srOnly}>搜尋洗衣單號</span>
              <input name="q" defaultValue={query} placeholder="搜尋洗衣單號" />
            </label>
            <button type="submit">搜尋</button>
          </form>
        </div>
        <div className={styles.tableHead} aria-hidden="true">
          <span>洗衣單 / 機構</span>
          <span>階段</span>
          <span>洗衣車</span>
        </div>
        {orders.length === 0 ? (
          <p className={styles.emptyQueue}>目前授權範圍內沒有未結案洗衣單。</p>
        ) : (
          <div className={styles.orderList}>
            {orders.map((order) => {
              const active = selected?.id === order.id;
              const row = (
                <>
                  <span className={styles.identity}>
                    <strong>{order.orderNumber}</strong>
                    <small>{order.institutionName}</small>
                  </span>
                  <span className={`${styles.badge} ${orderBadgeClass[order.status]}`}>
                    {orderStatusLabel(order.status)}
                  </span>
                  <span className={styles.due}>{order.cartNumber}</span>
                </>
              );
              return (
                <button
                  key={order.id}
                  type="button"
                  className={active ? `${styles.orderRow} ${styles.orderRowActive}` : styles.orderRow}
                  aria-pressed={active}
                  aria-label={`選取 ${order.orderNumber}，${orderStatusLabel(order.status)}`}
                  onClick={() => handleSelectOrder(order)}
                >
                  {row}
                </button>
              );
            })}
          </div>
        )}
        {pageCount > 1 ? (
          <nav className={styles.queuePager} aria-label="洗衣單分頁">
            {page > 1 ? <AppLink href={searchHref(page - 1)}>上一頁</AppLink> : <span>上一頁</span>}
            <small>{page} / {pageCount}</small>
            {page < pageCount ? <AppLink href={searchHref(page + 1)}>下一頁</AppLink> : <span>下一頁</span>}
          </nav>
        ) : null}
      </div>

      <aside className={styles.inspector} aria-label="選取洗衣單詳情">
        {selected ? (
          <div className={styles.selectedOrderCard} aria-label="目前選取洗衣單">
            <div className={styles.selectedOrderHead}>
              <div>
                <p className={styles.eyebrow}>SELECTED ORDER · 目前選取洗衣單</p>
                <div className={styles.selectedOrderTitleRow}>
                  <h2>{selected.orderNumber}</h2>
                  <button
                    type="button"
                    className={styles.copyOrderButton}
                    onClick={() => handleCopyOrderNumber(selected.orderNumber)}
                    aria-label="複製洗衣單號"
                  >
                    {copied ? "已複製 ✓" : "複製單號"}
                  </button>
                </div>
              </div>
              <span className={`${styles.badge} ${orderBadgeClass[selected.status]}`}>
                {orderStatusLabel(selected.status)}
              </span>
            </div>

            <div className={styles.selectedOrderMetaGrid}>
              <div className={styles.selectedOrderMetaItem}>
                <span>送洗機構</span>
                <strong>{selected.institutionName}</strong>
              </div>
              <div className={styles.selectedOrderMetaItem}>
                <span>實體洗衣車</span>
                <strong>{selected.cartNumber}</strong>
              </div>
              <div className={styles.selectedOrderMetaItem}>
                <span>建立時間</span>
                <strong>
                  {selectedDetail?.orderCreatedAt
                    ? new Date(selectedDetail.orderCreatedAt).toLocaleString("zh-TW", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "剛剛"}
                </strong>
              </div>
              <div className={styles.selectedOrderMetaItem}>
                <span>洗滌批次</span>
                <strong>
                  {selectedDetail?.batches.length
                    ? `${selectedDetail.batches.length} 個批次`
                    : selected.status === "awaiting_receipt"
                      ? "待收單建批"
                      : "0 個批次"}
                </strong>
              </div>
            </div>

            <div className={styles.selectedOrderActionRow}>
              {selected.status === "awaiting_receipt" ? (
                <AppLink
                  href={hrefWithClientScope("/app/operations/receive", { siteId: siteId ?? null, institutionId: null })}
                  className={styles.selectedOrderActionBtn}
                >
                  📋 前往收單建立分類批次 →
                </AppLink>
              ) : selected.status === "awaiting_cleaning" ? (
                <button
                  type="button"
                  className={styles.selectedOrderActionBtn}
                  onClick={() => setDetailOpen(true)}
                >
                  🫧 開始清洗控制點
                </button>
              ) : selected.status === "in_process" ? (
                <AppLink
                  href={hrefWithClientScope("/app/operations/control-center", { siteId: siteId ?? null, institutionId: null })}
                  className={styles.selectedOrderActionBtn}
                >
                  ⚙️ 前往批次控制中心 →
                </AppLink>
              ) : selected.status === "ready_for_pickup" ? (
                <span className={styles.selectedOrderHint}>
                  🚚 所有程序已完成，請由送洗人員掃描洗衣車 QR 完成取件結案。
                </span>
              ) : (
                <span className={styles.selectedOrderHint}>✓ 此單已完成取件結案。</span>
              )}
            </div>
          </div>
        ) : null}

        {selected || selectedDetail ? (
          <LaundryOrderFlow3D
            orderNumber={selected?.orderNumber}
            institutionName={selected?.institutionName}
            cartNumber={selected?.cartNumber}
            orderStatus={selected?.status ?? "in_process"}
            batches={selectedDetail?.batches ?? []}
            orderCreatedAt={selectedDetail?.orderCreatedAt}
            orderReceivedAt={selectedDetail?.orderReceivedAt}
            orderReadyAt={selectedDetail?.orderReadyAt}
            orderClosedAt={selectedDetail?.orderClosedAt}
            headerAction={
              selected?.status === "awaiting_receipt" ? (
                <AppLink
                  href={hrefWithClientScope("/app/operations/receive", { siteId: siteId ?? null, institutionId: null })}
                  className={styles.orderFlowHeaderAction}
                >
                  前往收單 ↗
                </AppLink>
              ) : selected?.status === "awaiting_cleaning" ? (
                <button
                  className={styles.orderFlowHeaderAction}
                  type="button"
                  onClick={() => setDetailOpen(true)}
                >
                  開始清洗
                </button>
              ) : selected?.status === "in_process" ? (
                <AppLink
                  href={hrefWithClientScope("/app/operations/control-center", { siteId: siteId ?? null, institutionId: null })}
                  className={styles.orderFlowHeaderAction}
                >
                  控制中心 ↗
                </AppLink>
              ) : null
            }
          />
        ) : (
          <p>選取一張洗衣單後，這裡會顯示目前允許的控制點與流程進度。</p>
        )}

        {selectedDetail?.batches && selectedDetail.batches.length > 0 ? (
          <div className={styles.orderDetailList} aria-label="洗衣單批次詳情">
            <p className={styles.eyebrow}>BATCH DETAIL / 此單專屬批次（{selectedDetail.batches.length}）</p>
            {selectedDetail.batches.map((batch) => (
              <BatchDetail key={batch.id} batch={batch} readOnly={readOnly} />
            ))}
          </div>
        ) : null}

        {equipment.length ? (
          <div className={styles.equipmentList}>
            <p className={styles.eyebrow}>EQUIPMENT</p>
            {equipment.slice(0, 6).map((item) => (
              <div key={item.id} className={styles.equipmentItem}>
                <i className={item.occupied ? styles.busy : item.status === "normal" ? styles.ready : styles.issue} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{equipmentTypeLabels[item.equipmentType]}</small>
                </span>
                <em>{item.occupied ? "使用中" : equipmentStatusLabels[item.status]}</em>
              </div>
            ))}
          </div>
        ) : null}
      </aside>

      {portalReady && detailOpen && selected
        ? createPortal(
          <div
            className={styles.controlPointBackdrop}
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDetail();
            }}
          >
            <section
              className={styles.controlPointModal}
              role="dialog"
              aria-modal="true"
              aria-label="開始清洗"
            >
              <button
                ref={closeButtonRef}
                className={styles.historyModalClose}
                type="button"
                onClick={closeDetail}
                aria-label="關閉"
              >
                ×
              </button>
              {readOnly ? (
                <p className={styles.controlHint}>目前沒有可操作的控制點。</p>
              ) : (
                <WashingModalContent siteId={siteId} />
              )}
            </section>
          </div>,
          document.body,
        )
        : null}
    </section>
  );
}

function BatchDetail({ batch, readOnly }: { batch: WorkspaceBatchDetail; readOnly: boolean }) {
  const activeStage = batch.stages.find((stage) => stage.state === "active");
  const currentStage = activeStage ?? batch.stages.find((stage) => stage.stageOrder === batch.currentStageOrder);
  const activeEquipment = batch.activeEquipmentName
    ? `${batch.activeEquipmentName}${batch.activeEquipmentType ? ` · ${equipmentTypeLabels[batch.activeEquipmentType]}` : ""}`
    : currentStage?.equipmentType && currentStage.equipmentType !== "manual" && currentStage.equipmentType !== "cart"
      ? equipmentTypeLabels[currentStage.equipmentType]
      : "待控制點";
  const statusLabel = batchStatusLabels[batch.status] ?? batch.status;
  const statusClass = batch.status === "paused"
    ? styles.badgeWarm
    : batch.status === "completed" || batch.status === "loaded"
      ? styles.badgeGreen
      : styles.badgeTeal;

  return (
    <article className={styles.batchDetailCard} aria-label={`批次 ${batch.batchSequence} ${batch.categoryName}`}>
      <header className={styles.batchDetailHead}>
        <div>
          <h3>B-{String(batch.batchSequence).padStart(3, "0")} · {batch.categoryName}</h3>
          <p>{batch.procedureName} v{batch.procedureVersion} · {activeEquipment}</p>
        </div>
        <span className={`${styles.badge} ${statusClass}`}>{statusLabel}</span>
      </header>

      {batch.stages.length ? (
        <ol className={styles.orderTimeline} aria-label="程序階段">
          {batch.stages.map((stage) => (
            <li
              key={stage.stageOrder}
              className={stage.state === "completed" ? styles.timelineCompleted : stage.state === "active" ? styles.timelineActive : styles.timelinePending}
            >
              <span aria-hidden="true">{stage.state === "completed" ? "✓" : stage.stageOrder}</span>
              <div>
                <strong>{stage.name}{stage.state === "completed" ? "已完成" : stage.state === "active" ? "實際狀態" : "等候控制點"}</strong>
                <small>{stage.standardMinutes} 分鐘標準時間 · {stage.state === "active" ? Math.round(batch.progress.stageProgressPercent) : stage.state === "completed" ? 100 : 0}% 預估</small>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.batchProgress}>
        <div><strong>程序預估進度（不自動改實際狀態）</strong><b>{Math.round(batch.progress.overallProgressPercent)}%</b></div>
        <progress max="100" value={batch.progress.overallProgressPercent} aria-label={`${batch.categoryName} 程序預估進度`} />
        {batch.progress.overdueMinutes > 0 ? <small>已超過預估 {batch.progress.overdueMinutes} 分鐘，仍需人員確認。</small> : null}
      </div>

      {!readOnly && batch.progress.stageRunId && currentStage ? (
        <p className={styles.detailActionHint}>再掃同一{batch.activeEquipmentType ? equipmentTypeLabels[batch.activeEquipmentType] : "設備"}結束{currentStage.name} ↗</p>
      ) : null}
    </article>
  );
}
