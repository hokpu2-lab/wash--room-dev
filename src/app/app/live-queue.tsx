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

const statusPillClass = {
  awaiting_receipt: styles.statusPillGray,
  awaiting_cleaning: styles.statusPillBlue,
  in_process: styles.statusPillOrange,
  ready_for_pickup: styles.statusPillGreen,
  picked_up: styles.statusPillGray,
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
  syncedAt?: string | null;
  onSelectOrder?: (orderId: string, orderNumber: string) => void;
};

function formatLastUpdated(syncedAt?: string | null) {
  const d = syncedAt ? new Date(syncedAt) : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "下午" : "上午";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${year}/${month}/${day} ${period} ${displayHours}:${minutes}`;
}

function formatOrderTime(isoString?: string | null) {
  if (!isoString) return "剛剛";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "剛剛";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "下午" : "上午";
  const displayHours = String(hours % 12 === 0 ? 12 : hours % 12).padStart(2, "0");
  return `${month}/${day} ${period} ${displayHours}:${minutes}`;
}

function formatReceiptTime(isoString?: string | null) {
  if (!isoString) return "剛剛";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "剛剛";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "下午" : "上午";
  const displayHours = String(hours % 12 === 0 ? 12 : hours % 12).padStart(2, "0");
  return `${month}/${day} ${period} ${displayHours}:${minutes}`;
}

function matchesSearch(order: WorkspaceOrder, term: string): boolean {
  if (!term) return true;
  const q = term.trim().toLocaleLowerCase("zh-Hant");
  if (!q) return true;
  const statusLabel = (orderStatusLabel(order.status) || "").toLocaleLowerCase("zh-Hant");
  const rawStatus = (order.status || "").toLocaleLowerCase("zh-Hant");
  const institution = (order.institutionName || "").toLocaleLowerCase("zh-Hant");
  const cart = (order.cartNumber || "").toLocaleLowerCase("zh-Hant");
  const orderNum = (order.orderNumber || "").toLocaleLowerCase("zh-Hant");

  return (
    orderNum.includes(q) ||
    institution.includes(q) ||
    cart.includes(q) ||
    statusLabel.includes(q) ||
    rawStatus.includes(q)
  );
}

export function LiveQueueFallback({ title = "洗衣單清單" }: { title?: string } = {}) {
  const displayTitle = title.includes("Order List") ? title : `${title} (Order List)`;
  return (
    <section className={styles.liveQueueSection} aria-labelledby="live-queue-title">
      <div className={styles.topCardsGrid}>
        <div className={styles.queueCard}>
          <div className={styles.queueCardHead}>
            <h2 id="live-queue-title" className={styles.queueCardTitle}>{displayTitle}</h2>
            <p className={styles.queueCardSubtitle}>載入中...</p>
          </div>
          <div className={styles.skeletonStack} aria-hidden="true">
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLine} />
          </div>
        </div>
        <div className={styles.selectedOrderCardContainer}>
          <div className={styles.selectedOrderCardHeader}>
            <h2 className={styles.selectedOrderCardTitle}>選取的洗衣單 (Selected Order)</h2>
          </div>
          <div className={styles.skeletonStack} aria-hidden="true">
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLine} />
          </div>
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
  title = "洗衣單清單",
  syncedAt,
  onSelectOrder,
}: LiveQueueProps) {
  const [selectedId, setSelectedId] = useState<string | null>(selectedOrderId ?? orders[0]?.id ?? null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState(query);
  const [detailOpen, setDetailOpen] = useState(false);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [fetchedDetail, setFetchedDetail] = useState<WorkspaceOrderDetail | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (selectedOrderId) setSelectedId(selectedOrderId);
  }, [selectedOrderId]);

  useEffect(() => {
    setSearchTerm(query);
  }, [query]);

  const displayedOrders = orders.filter((order) => {
    const matchesStatus = !statusFilter || order.status === statusFilter;
    const matchesQuery = matchesSearch(order, searchTerm);
    return matchesStatus && matchesQuery;
  });

  const activeSelectedId = selectedId && displayedOrders.some((order) => order.id === selectedId)
    ? selectedId
    : selectedOrderId && displayedOrders.some((order) => order.id === selectedOrderId)
      ? selectedOrderId
      : selectedId && orders.some((order) => order.id === selectedId)
        ? selectedId
        : displayedOrders[0]?.id
          ?? orders[0]?.id
          ?? null;
  const selected = orders.find((order) => order.id === activeSelectedId) ?? null;
  const selectedDetail = selected
    ? orderDetails.find((detail) => detail.orderId === selected.id)
      ?? (fetchedDetail?.orderId === selected.id ? fetchedDetail : null)
    : fetchedDetail?.orderId === activeSelectedId ? fetchedDetail : null;

  const activeEquipmentNames = selectedDetail?.batches
    ?.map((batch) => batch.activeEquipmentName)
    .filter((name): name is string => Boolean(name));
  const activeEquipmentText = activeEquipmentNames && activeEquipmentNames.length > 0
    ? Array.from(new Set(activeEquipmentNames)).join("、")
    : null;

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

  const inProcessCount = orders.filter((o) => o.status === "in_process").length;
  const awaitingCleaningCount = orders.filter((o) => o.status === "awaiting_cleaning").length;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const searchHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (searchTerm) params.set("q", searchTerm);
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

  const displayTitle = title.includes("Order List") ? title : `${title} (Order List)`;

  return (
    <section className={styles.liveQueueSection} aria-labelledby="live-queue-title">
      {/* Top Cards Row: Left (Order List) + Right (Selected Order) */}
      <div className={styles.topCardsGrid}>
        {/* Left Card: 洗衣單清單 (Order List) */}
        <div className={styles.queueCard}>
          <div className={styles.queueCardHead}>
            <div>
              <h2 id="live-queue-title" className={styles.queueCardTitle}>
                {displayTitle}
              </h2>
              <p className={styles.queueCardSubtitle}>
                最後更新 : {formatLastUpdated(syncedAt)} (Last Updated)
              </p>
            </div>
          </div>

          <div className={styles.queueSearchAndFilterRow}>
            <form className={styles.queueSearchForm} method="get">
              {siteId ? <input type="hidden" name="site" value={siteId} /> : null}
              <label className={styles.queueSearchLabel}>
                <span className={styles.srOnly}>搜尋狀態、機構、車號或單號</span>
                <input
                  name="q"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜尋狀態、機構、車號或單號"
                  className={styles.queueSearchInput}
                />
              </label>
              <button type="submit" className={styles.queueSearchBtn}>
                搜尋 (Search)
              </button>
            </form>

            <div className={styles.queueFilterGroup} role="group" aria-label="狀態篩選">
              <button
                type="button"
                className={statusFilter === null ? `${styles.filterPill} ${styles.filterPillAll} ${styles.filterPillActive}` : `${styles.filterPill} ${styles.filterPillAll}`}
                onClick={() => setStatusFilter(null)}
                aria-pressed={statusFilter === null}
              >
                全部
              </button>
              <button
                type="button"
                className={statusFilter === "in_process" ? `${styles.filterPill} ${styles.filterPillOrange} ${styles.filterPillActive}` : `${styles.filterPill} ${styles.filterPillOrange}`}
                onClick={() => setStatusFilter(statusFilter === "in_process" ? null : "in_process")}
                aria-pressed={statusFilter === "in_process"}
              >
                處理中{inProcessCount > 0 ? ` (${inProcessCount})` : ""}
              </button>
              <button
                type="button"
                className={statusFilter === "awaiting_cleaning" ? `${styles.filterPill} ${styles.filterPillBlue} ${styles.filterPillActive}` : `${styles.filterPill} ${styles.filterPillBlue}`}
                onClick={() => setStatusFilter(statusFilter === "awaiting_cleaning" ? null : "awaiting_cleaning")}
                aria-pressed={statusFilter === "awaiting_cleaning"}
              >
                待清洗{awaitingCleaningCount > 0 ? ` (${awaitingCleaningCount})` : ""}
              </button>
            </div>
          </div>

          <div className={styles.queueListHeader}>
            <span>排序隊列 / {String(displayedOrders.length).padStart(2, "0")}</span>
            {statusFilter ? (
              <span className={styles.filterActiveNotice}>
                （已篩選：{statusFilter === "in_process" ? "處理中" : "待清洗"}，共 {displayedOrders.length} 筆）
              </span>
            ) : null}
          </div>

          <div className={styles.orderListTableHead} aria-hidden="true">
            <span>狀態</span>
            <span>機構</span>
            <span>車號</span>
            <span>收單時間</span>
            <span>洗衣單號</span>
          </div>

          {displayedOrders.length === 0 ? (
            <p className={styles.emptyQueue}>目前沒有符合條件的洗衣單。</p>
          ) : (
            <div className={styles.orderListContainer}>
              {displayedOrders.map((order) => {
                const active = selected?.id === order.id;
                const orderDetail = orderDetails.find((d) => d.orderId === order.id);
                const timeValue = orderDetail?.orderReceivedAt ?? orderDetail?.orderCreatedAt ?? order.updatedAt;
                return (
                  <button
                    key={order.id}
                    type="button"
                    className={active ? `${styles.orderListItem} ${styles.orderListItemActive}` : styles.orderListItem}
                    aria-pressed={active}
                    aria-label={`選取 ${order.orderNumber}，${orderStatusLabel(order.status)}`}
                    onClick={() => handleSelectOrder(order)}
                  >
                    <span className={`${styles.statusPill} ${statusPillClass[order.status]}`}>
                      {orderStatusLabel(order.status)}
                    </span>
                    <span className={styles.orderItemInstitution} title={order.institutionName}>
                      {order.institutionName}
                    </span>
                    <span className={styles.orderItemCart} title={order.cartNumber}>
                      {order.cartNumber}
                    </span>
                    <span className={styles.orderItemTime}>
                      {formatReceiptTime(timeValue)}
                    </span>
                    <strong className={styles.orderItemNumber} title={order.orderNumber}>
                      {order.orderNumber}
                    </strong>
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

        {/* Right Card: 選取的洗衣單 (Selected Order) */}
        <div className={styles.selectedOrderCardContainer} aria-label="選取洗衣單詳情">
          <div className={styles.selectedOrderCardHeader}>
            <h2 className={styles.selectedOrderCardTitle}>
              選取的洗衣單 (Selected Order)
            </h2>
          </div>

          {selected ? (
            <div className={styles.selectedOrderCardContent}>
              <div className={styles.selectedOrderNumRow}>
                <span className={styles.selectedOrderNumberDisplay}>
                  {selected.orderNumber}
                </span>
                <button
                  type="button"
                  className={styles.copyPillBtn}
                  onClick={() => handleCopyOrderNumber(selected.orderNumber)}
                  aria-label="複製洗衣單號"
                >
                  {copied ? "已複製 ✓" : "複製單號"}
                </button>
              </div>

              <div className={styles.orderMetaGridCard}>
                <div className={styles.orderMetaCol}>
                  <span className={styles.orderMetaColLabel}>Status</span>
                  <strong className={styles.orderMetaColVal}>
                    {activeEquipmentText || orderStatusLabel(selected.status)}
                  </strong>
                </div>
                <div className={styles.orderMetaCol}>
                  <span className={styles.orderMetaColLabel}>Institution</span>
                  <strong className={styles.orderMetaColVal}>{selected.institutionName}</strong>
                </div>
                <div className={styles.orderMetaCol}>
                  <span className={styles.orderMetaColLabel}>Vehicle</span>
                  <strong className={styles.orderMetaColVal}>{selected.cartNumber}</strong>
                </div>
                <div className={styles.orderMetaCol}>
                  <span className={styles.orderMetaColLabel}>Time</span>
                  <strong className={styles.orderMetaColVal}>
                    {formatOrderTime(selectedDetail?.orderCreatedAt)}
                  </strong>
                </div>
                <div className={styles.orderMetaCol}>
                  <span className={styles.orderMetaColLabel}>Batches</span>
                  <strong className={styles.orderMetaColVal}>
                    {selectedDetail?.batches.length
                      ? `${selectedDetail.batches.length} 個批次`
                      : selected.status === "awaiting_receipt"
                        ? "待收單建批"
                        : "0 個批次"}
                  </strong>
                </div>
              </div>

              <div className={styles.selectedOrderMainActionRow}>
                {selected.status === "awaiting_receipt" ? (
                  <AppLink
                    href={hrefWithClientScope("/app/operations/receive", { siteId: siteId ?? null, institutionId: null })}
                    className={styles.primaryActionCta}
                  >
                    前往收單建立分類批次 →
                  </AppLink>
                ) : selected.status === "awaiting_cleaning" ? (
                  <button
                    type="button"
                    className={styles.primaryActionCta}
                    onClick={() => setDetailOpen(true)}
                  >
                    開始清洗控制點 →
                  </button>
                ) : selected.status === "in_process" ? (
                  <AppLink
                    href={hrefWithClientScope("/app/operations/control-center", { siteId: siteId ?? null, institutionId: null })}
                    className={styles.primaryActionCta}
                  >
                    前往批次控制中心 →
                  </AppLink>
                ) : selected.status === "ready_for_pickup" ? (
                  <span className={styles.primaryActionInfo}>
                    🚚 所有程序已完成，請由送洗人員掃描洗衣車 QR 完成取件結案。
                  </span>
                ) : (
                  <span className={styles.primaryActionInfo}>✓ 此單已完成取件結案。</span>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.noOrderSelected}>
              <p>選取一張洗衣單後，這裡會顯示目前允許的控制點與流程進度。</p>
            </div>
          )}
        </div>
      </div>

      {/* Laundry Order Flow & Batches Section below */}
      <div className={styles.flowAndDetailsSection}>
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
          <p className={styles.flowEmptyNotice}>選取一張洗衣單後，這裡會顯示目前允許的控制點與流程進度。</p>
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
      </div>

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
