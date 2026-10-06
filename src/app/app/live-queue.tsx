"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  WorkspaceEquipment,
  WorkspaceOrder,
  WorkspaceOrderDetail,
} from "@/lib/analytics/workspace-snapshot";

import { AppLink } from "./app-link";
import { LaundryOrderFlow3D } from "./laundry-order-flow-3d";
import { WashingModalContent } from "./operations/washing/modal-content";
import {
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

function getEquipmentTypeName(type: string | undefined | null): string {
  if (!type) return "洗衣機";
  if (type in equipmentTypeLabels) {
    return equipmentTypeLabels[type as keyof typeof equipmentTypeLabels];
  }
  if (type === "cart") return "洗衣車";
  if (type === "manual") return "人工處理";
  return type;
}

function getEquipmentNameDisplay(
  order: WorkspaceOrder,
  detail: WorkspaceOrderDetail | null,
): string {
  if (order.status === "awaiting_receipt") return "待收單";
  if (order.status === "ready_for_pickup" || order.status === "picked_up") return "已完成";

  if (detail?.batches && detail.batches.length > 0) {
    const equipmentNames = detail.batches.map((batch) => {
      const activeStage = batch.stages.find((s) => s.state === "active");
      const currentStage =
        activeStage ??
        batch.stages.find((s) => s.stageOrder === batch.currentStageOrder) ??
        batch.stages[0];
      return (
        batch.activeEquipmentName ||
        (currentStage?.equipmentType && getEquipmentTypeName(currentStage.equipmentType)) ||
        "洗衣機"
      );
    });
    const result = Array.from(new Set(equipmentNames)).join("、");
    if (result === "待取件" || result === "已取件") return "已完成";
    return result;
  }

  if (order.status === "awaiting_cleaning" || order.status === "in_process") return "洗衣機";
  const label = orderStatusLabel(order.status) || "待清洗";
  if (label === "待取件" || label === "已取件") return "已完成";
  return label;
}

function getOrderStageProgressDisplay(
  order: WorkspaceOrder,
  detail: WorkspaceOrderDetail | null,
): string {
  if (order.status === "awaiting_receipt") return "待收單";
  if (order.status === "ready_for_pickup") return "待取件";
  if (order.status === "picked_up") return "已取件";

  if (detail?.batches && detail.batches.length > 0) {
    const stageDisplays = detail.batches.map((batch) => {
      const activeStage = batch.stages.find((s) => s.state === "active");
      const currentStage =
        activeStage ??
        batch.stages.find((s) => s.stageOrder === batch.currentStageOrder) ??
        batch.stages[0];
      const stageOrder = currentStage?.stageOrder ?? batch.currentStageOrder ?? 1;
      return `第 ${stageOrder} 階段`;
    });
    return Array.from(new Set(stageDisplays)).join("、");
  }

  return "第 1 階段";
}

function calculateWaitingTime(
  order: WorkspaceOrder,
  detail: WorkspaceOrderDetail | null,
): string {
  if (order.status === "awaiting_receipt") {
    return "待收單";
  }

  const receiptIso = detail?.orderReceivedAt || detail?.orderCreatedAt;
  if (!receiptIso) return "—";

  const receiptTime = new Date(receiptIso).getTime();
  if (isNaN(receiptTime)) return "—";

  let stage1StartedTime: number | null = null;
  if (detail?.batches && detail.batches.length > 0) {
    for (const batch of detail.batches) {
      const stage1 = batch.stages.find((s) => s.stageOrder === 1);
      if (stage1?.startedAt) {
        const t = new Date(stage1.startedAt).getTime();
        if (!isNaN(t)) {
          if (stage1StartedTime === null || t < stage1StartedTime) {
            stage1StartedTime = t;
          }
        }
      }
    }
  }

  let diffMinutes: number;
  if (stage1StartedTime !== null) {
    const diffMs = Math.max(0, stage1StartedTime - receiptTime);
    diffMinutes = Math.round(diffMs / (1000 * 60));
  } else {
    const diffMs = Math.max(0, Date.now() - receiptTime);
    diffMinutes = Math.round(diffMs / (1000 * 60));
  }

  if (diffMinutes < 1) return "0 分鐘";
  if (diffMinutes < 60) return `${diffMinutes} 分鐘`;
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return mins > 0 ? `${hours} 小時 ${mins} 分鐘` : `${hours} 小時`;
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

export function LiveQueueFallback({ title = "洗衣排程" }: { title?: string } = {}) {
  return (
    <section className={styles.liveQueueSection} aria-labelledby="live-queue-title">
      <div className={styles.topCardsGrid}>
        <div className={styles.queueCard}>
          <div className={styles.queueCardHead}>
            <h2 id="live-queue-title" className={styles.queueCardTitle}>{title}</h2>
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
            <h2 className={styles.selectedOrderCardTitle}>選取的洗衣單</h2>
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
  title = "洗衣排程",
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

  const awaitingReceiptCount = orders.filter((o) => o.status === "awaiting_receipt").length;
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

  return (
    <section className={styles.liveQueueSection} aria-labelledby="live-queue-title">
      {/* Top Cards Row: Left + Right */}
      <div className={styles.topCardsGrid}>
        {/* Left Card: 洗衣排程 */}
        <div className={styles.queueCard}>
          <div className={styles.queueCardHead}>
            <div>
              <h2 id="live-queue-title" className={styles.queueCardTitle}>
                {title}
              </h2>
              <p className={styles.queueCardSubtitle}>
                最後更新 : {formatLastUpdated(syncedAt)}
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
                搜尋
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
                className={statusFilter === "awaiting_receipt" ? `${styles.filterPill} ${styles.filterPillGray} ${styles.filterPillActive}` : `${styles.filterPill} ${styles.filterPillGray}`}
                onClick={() => setStatusFilter(statusFilter === "awaiting_receipt" ? null : "awaiting_receipt")}
                aria-pressed={statusFilter === "awaiting_receipt"}
              >
                待收件{awaitingReceiptCount > 0 ? ` (${awaitingReceiptCount})` : ""}
              </button>
              <button
                type="button"
                className={statusFilter === "awaiting_cleaning" ? `${styles.filterPill} ${styles.filterPillBlue} ${styles.filterPillActive}` : `${styles.filterPill} ${styles.filterPillBlue}`}
                onClick={() => setStatusFilter(statusFilter === "awaiting_cleaning" ? null : "awaiting_cleaning")}
                aria-pressed={statusFilter === "awaiting_cleaning"}
              >
                待清洗{awaitingCleaningCount > 0 ? ` (${awaitingCleaningCount})` : ""}
              </button>
              <button
                type="button"
                className={statusFilter === "in_process" ? `${styles.filterPill} ${styles.filterPillOrange} ${styles.filterPillActive}` : `${styles.filterPill} ${styles.filterPillOrange}`}
                onClick={() => setStatusFilter(statusFilter === "in_process" ? null : "in_process")}
                aria-pressed={statusFilter === "in_process"}
              >
                處理中{inProcessCount > 0 ? ` (${inProcessCount})` : ""}
              </button>
            </div>
          </div>

          <div className={styles.queueListHeader}>
            <span>排序隊列 / {String(displayedOrders.length).padStart(2, "0")}</span>
            {statusFilter ? (
              <span className={styles.filterActiveNotice}>
                （已篩選：{orderStatusLabel(statusFilter as any) || "篩選項目"}，共 {displayedOrders.length} 筆）
              </span>
            ) : null}
          </div>

          <div className={styles.orderListTableHead} aria-hidden="true">
            <span>狀態</span>
            <span>機構</span>
            <span>車號</span>
            <span>收單時間</span>
          </div>

          {displayedOrders.length === 0 ? (
            <div className={styles.emptyQueueBox}>
              <p className={styles.emptyQueue}>目前沒有符合條件的洗衣單。</p>
              {searchTerm || statusFilter ? (
                <button
                  type="button"
                  className={styles.resetFilterBtn}
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter(null);
                    if (typeof window !== "undefined") {
                      const url = new URL(window.location.href);
                      url.searchParams.delete("q");
                      window.history.replaceState(null, "", url.toString());
                    }
                  }}
                >
                  🔄 清除搜尋與篩選條件
                </button>
              ) : null}
            </div>
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

        {/* Right Card: 選取的洗衣單 */}
        <div className={styles.selectedOrderCardContainer} aria-label="選取洗衣單詳情">
          <div className={styles.selectedOrderCardHeader}>
            <h2 className={styles.selectedOrderCardTitle}>
              選取的洗衣單
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
                  <span className={styles.orderMetaColLabel}>使用中設備</span>
                  <strong className={styles.orderMetaColVal}>
                    {getEquipmentNameDisplay(selected, selectedDetail)}
                  </strong>
                </div>
                <div className={styles.orderMetaCol}>
                  <span className={styles.orderMetaColLabel}>進度</span>
                  <strong className={styles.orderMetaColVal}>
                    {getOrderStageProgressDisplay(selected, selectedDetail)}
                  </strong>
                </div>
                <div className={styles.orderMetaCol}>
                  <span className={styles.orderMetaColLabel}>車號</span>
                  <strong className={styles.orderMetaColVal}>{selected.cartNumber}</strong>
                </div>
                <div className={styles.orderMetaCol}>
                  <span className={styles.orderMetaColLabel}>收單時間</span>
                  <strong className={styles.orderMetaColVal}>
                    {formatOrderTime(selectedDetail?.orderReceivedAt ?? selectedDetail?.orderCreatedAt)}
                  </strong>
                </div>
                <div className={styles.orderMetaCol}>
                  <span className={styles.orderMetaColLabel}>等待時間</span>
                  <strong className={styles.orderMetaColVal}>
                    {calculateWaitingTime(selected, selectedDetail)}
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
            equipment={equipment}
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
                <WashingModalContent
                  siteId={siteId}
                  selectedOrderNumber={selected.orderNumber}
                  selectedCartNumber={selected.cartNumber}
                  selectedInstitutionName={selected.institutionName}
                  focusedBatchId={selectedDetail?.batches[0]?.id}
                />
              )}
            </section>
          </div>,
          document.body,
        )
        : null}
    </section>
  );
}
