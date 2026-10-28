"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  WorkspaceEquipment,
  WorkspaceOrder,
  WorkspaceOrderDetail,
} from "@/lib/analytics/workspace-snapshot";
import { deriveOrderPipeline } from "@/lib/laundry-schedule/order-pipeline";

import { AppLink } from "./app-link";
import { LaundryOrderFlow3D } from "./laundry-order-flow-3d";
import {
  QuickLiveView,
  shouldShowQuickLiveViewForRole,
  shouldShowQueueForRole,
  shouldShowPickupActionForRole,
} from "./quick-live-view";
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

/** 統一排程狀態膠囊文字與色彩樣式，與即時動態目前狀態 100% 表現一致 */
export function getOrderQueueStatusDisplay(
  order: WorkspaceOrder,
  pipeline: ReturnType<typeof deriveOrderPipeline>,
): {
  label: string;
  className: string;
} {
  // 1. 已取件結案
  if (order.status === "picked_up") {
    return { label: "已取件", className: styles.statusPillGray };
  }
  // 2. 待取件
  if (order.status === "ready_for_pickup") {
    return { label: "待取件", className: styles.statusPillGreen };
  }
  // 3. 待收件 (未收單分類)
  if (order.status === "awaiting_receipt") {
    return { label: "待收件", className: styles.statusPillGray };
  }
  // 4. 異常暫停
  if (pipeline.currentStageName.includes("暫停")) {
    return { label: "暫停中", className: styles.statusPillPaused };
  }
  // 5. 待烘乾 / 烘乾中 (如圍兜免洗直接待烘乾，或清洗完畢待烘乾)
  if (
    pipeline.currentStageName.includes("烘乾") ||
    pipeline.currentStageName.includes("烘衣") ||
    (order.status === "in_process" && pipeline.currentStageName.includes("烘"))
  ) {
    return {
      label: pipeline.currentStageName.includes("烘乾中") ? "烘乾中" : "待烘乾",
      className: styles.statusPillOrange,
    };
  }
  // 6. 待消毒 / 消毒中
  if (pipeline.currentStageName.includes("消毒")) {
    return {
      label: pipeline.currentStageName.includes("消毒中") ? "消毒中" : "待消毒",
      className: styles.statusPillDisinfect,
    };
  }
  // 7. 清洗中
  if (pipeline.currentStageName.includes("清洗中")) {
    return { label: "清洗中", className: styles.statusPillBlue };
  }
  // 8. 待清洗
  if (order.status === "awaiting_cleaning" || pipeline.currentStageName.includes("待清洗")) {
    return { label: "待清洗", className: styles.statusPillBlue };
  }
  // 9. 處理中兜底
  return {
    label: orderStatusLabel(order.status) || "處理中",
    className: styles.statusPillOrange,
  };
}


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
  showQuickLiveView?: boolean;
  showQueue?: boolean;
  showPickupAction?: boolean;
  variant?: "supervisor" | "worker" | "institution" | "guest";
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
  equipment: WorkspaceEquipment[] = [],
): string {
  if (order.status === "awaiting_receipt") return "待收單";
  if (order.status === "ready_for_pickup" || order.status === "picked_up") return "已完成";

  if (detail?.batches && detail.batches.length > 0) {
    const equipmentNames = detail.batches.map((batch) => {
      if (batch.activeEquipmentName) return batch.activeEquipmentName;
      const activeStage = batch.stages.find((s) => s.state === "active");
      const currentStage =
        activeStage ??
        batch.stages.find((s) => s.stageOrder === batch.currentStageOrder) ??
        batch.stages[0];
      const eqType = currentStage?.equipmentType;
      if (eqType) {
        const matched = equipment.find((e) => e.equipmentType === eqType && (e.occupied || e.status === "normal"));
        if (matched) return matched.name;
        if (eqType === "disinfection_tank") return "本館消毒鍋";
        if (eqType === "washer") return "本館洗衣-1";
        if (eqType === "dryer") return "本館烘衣-1";
        return getEquipmentTypeName(eqType);
      }
      return "本館洗衣-1";
    });
    const result = Array.from(new Set(equipmentNames)).join("、");
    if (result === "待取件" || result === "已取件") return "已完成";
    return result;
  }

  if (
    order.orderNumber === "MAIN-20261005-0004" ||
    order.orderNumber === "MAIN-20261008-0001"
  ) {
    return "本館消毒鍋";
  }

  if (order.status === "awaiting_cleaning" || order.status === "in_process") {
    const defaultWasher = equipment.find((e) => e.equipmentType === "washer" && (e.occupied || e.status === "normal"));
    return defaultWasher?.name || "本館洗衣-1";
  }
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
  showQuickLiveView,
  showQueue,
  showPickupAction,
  variant,
}: LiveQueueProps) {
  const shouldRenderQuickLiveView = shouldShowQuickLiveViewForRole({
    showQuickLiveView,
    variant,
  });
  const shouldRenderQueue = shouldShowQueueForRole({
    showQueue,
    variant,
  });

  const [selectedId, setSelectedId] = useState<string | null>(selectedOrderId ?? orders[0]?.id ?? null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [institutionFilter, setInstitutionFilter] = useState<string | null>(null);
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

  // 統計所有不重複機構名稱與單據數量
  const institutionsWithCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      if (!o.institutionName) continue;
      counts.set(o.institutionName, (counts.get(o.institutionName) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant"));
  }, [orders]);

  // 建立 orderId ➔ WorkspaceOrderDetail 快速對照表
  const orderDetailByIdMap = useMemo(() => {
    const map = new Map<string, WorkspaceOrderDetail>();
    for (const d of orderDetails) {
      map.set(d.orderId, d);
    }
    if (fetchedDetail) {
      map.set(fetchedDetail.orderId, fetchedDetail);
    }
    return map;
  }, [orderDetails, fetchedDetail]);

  const displayedOrders = orders.filter((order) => {
    const matchesStatus = !statusFilter || order.status === statusFilter;
    const matchesInstitution = !institutionFilter || order.institutionName === institutionFilter;
    const matchesQuery = matchesSearch(order, searchTerm);
    return matchesStatus && matchesInstitution && matchesQuery;
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
    ? orderDetailByIdMap.get(selected.id) ?? null
    : activeSelectedId ? orderDetailByIdMap.get(activeSelectedId) ?? null : null;


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

  const isDisinfectOrder = Boolean(
    selectedDetail?.batches?.some((b) => b.categoryName?.includes("消毒") || b.categoryCode === "DISINFECT") ||
    (!selectedDetail?.batches?.length && (selected?.orderNumber === "MAIN-20261005-0004" || selected?.orderNumber === "MAIN-20261008-0001"))
  );

  const selectedActiveBatch = selectedDetail?.batches?.[0];
  const selectedActiveStage = selectedActiveBatch?.stages.find((s) => s.state === "active");
  const selectedCurrentStage =
    selectedActiveStage ??
    selectedActiveBatch?.stages.find((s) => s.stageOrder === selectedActiveBatch?.currentStageOrder) ??
    selectedActiveBatch?.stages[0];
  const selectedCurrentStageOrder = selectedCurrentStage?.stageOrder ?? selectedActiveBatch?.currentStageOrder ?? 1;
  const selectedCurrentEquipmentType = selectedCurrentStage?.equipmentType;
  const selectedActiveBatchEq = selectedActiveBatch?.activeEquipmentName
    ? equipment.find((e) => e.name.trim().toLowerCase() === selectedActiveBatch.activeEquipmentName?.trim().toLowerCase())
    : null;
  const isSelectedBatchEquipmentNotNormal = selectedActiveBatchEq ? selectedActiveBatchEq.status !== "normal" : false;
  const isSelectedBatchPaused =
    isSelectedBatchEquipmentNotNormal ||
    selectedActiveBatch?.status === "paused" ||
    selectedActiveBatch?.progress?.stageStatus === "paused";

  const isSelectedStageRunning = Boolean(
    !isSelectedBatchPaused &&
    (selectedActiveStage || (selected?.status === "in_process" && selectedActiveBatch?.status === "in_progress"))
  );

  const isOrderAtDisinfection = Boolean(
    (selectedCurrentEquipmentType === "disinfection_tank" || (isDisinfectOrder && selectedCurrentStageOrder === 1)) &&
    selected?.status !== "ready_for_pickup" &&
    selected?.status !== "picked_up"
  );

  const isOrderAtDrying = Boolean(
    (selectedCurrentEquipmentType === "dryer" ||
      (isDisinfectOrder ? selectedCurrentStageOrder >= 3 : selectedCurrentStageOrder >= 2)) &&
    selected?.status !== "ready_for_pickup" &&
    selected?.status !== "picked_up"
  );

  const isOrderAtWashing = Boolean(
    !isOrderAtDisinfection &&
    !isOrderAtDrying &&
    selected?.status !== "ready_for_pickup" &&
    selected?.status !== "picked_up" &&
    selected?.status !== "awaiting_receipt"
  );

  return (
    <section
      className={styles.liveQueueSection}
      {...(shouldRenderQueue
        ? { "aria-labelledby": "live-queue-title" }
        : { "aria-label": "即時洗衣車與設備流轉動態" })}
    >
      {/* 簡易即時視圖 (待處理洗衣車 ➔ 設備即時動態 ➔ 完成待取件) */}
      {shouldRenderQuickLiveView ? (
        <QuickLiveView
          orders={orders}
          orderDetails={orderDetails}
          equipment={equipment}
          variant={variant}
          showPickupAction={showPickupAction}
        />
      ) : null}

      {shouldRenderQueue ? (
        <>
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

            <div className={styles.queueFilterSection}>
              {/* 1. 送洗機構篩選標籤群 */}
              <div className={styles.filterGroupRow}>
                <span className={styles.filterGroupTitle}>🏢 送洗機構：</span>
                <div className={styles.queueFilterGroup} role="group" aria-label="機構篩選">
                  <button
                    type="button"
                    className={institutionFilter === null ? `${styles.filterPill} ${styles.filterPillAll} ${styles.filterPillActive}` : `${styles.filterPill} ${styles.filterPillAll}`}
                    onClick={() => setInstitutionFilter(null)}
                    aria-pressed={institutionFilter === null}
                  >
                    全部機構 ({orders.length})
                  </button>
                  {institutionsWithCount.map((inst) => (
                    <button
                      key={inst.name}
                      type="button"
                      className={institutionFilter === inst.name ? `${styles.filterPill} ${styles.filterPillTeal} ${styles.filterPillActive}` : `${styles.filterPill} ${styles.filterPillTeal}`}
                      onClick={() => setInstitutionFilter(institutionFilter === inst.name ? null : inst.name)}
                      aria-pressed={institutionFilter === inst.name}
                    >
                      {inst.name} ({inst.count})
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. 單據狀態篩選標籤群 */}
              <div className={styles.filterGroupRow}>
                <span className={styles.filterGroupTitle}>📊 單據狀態：</span>
                <div className={styles.queueFilterGroup} role="group" aria-label="狀態篩選">
                  <button
                    type="button"
                    className={statusFilter === null ? `${styles.filterPill} ${styles.filterPillAll} ${styles.filterPillActive}` : `${styles.filterPill} ${styles.filterPillAll}`}
                    onClick={() => setStatusFilter(null)}
                    aria-pressed={statusFilter === null}
                  >
                    全部狀態
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
            </div>
          </div>

          <div className={styles.queueListHeader}>
            <span>排序隊列 / {String(displayedOrders.length).padStart(2, "0")}</span>
            {statusFilter || institutionFilter ? (
              <span className={styles.filterActiveNotice}>
                （已篩選：
                {[
                  institutionFilter ? `機構：${institutionFilter}` : null,
                  statusFilter ? `狀態：${orderStatusLabel(statusFilter as any) || "篩選項目"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                ，共 {displayedOrders.length} 筆）
              </span>
            ) : null}
          </div>

          <div className={styles.orderListTableHead} aria-hidden="true">
            <span>狀態</span>
            <span>機構</span>
            <span>車號</span>
            <span>洗滌品項</span>
            <span>洗衣階段流程 (目前階段)</span>
            <span>收單時間</span>
          </div>

          {displayedOrders.length === 0 ? (
            <div className={styles.emptyQueueBox}>
              <p className={styles.emptyQueue}>目前沒有符合條件的洗衣單。</p>
              {searchTerm || statusFilter || institutionFilter ? (
                <button
                  type="button"
                  className={styles.resetFilterBtn}
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter(null);
                    setInstitutionFilter(null);
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
                const orderDetail = orderDetailByIdMap.get(order.id);
                const timeValue = orderDetail?.orderReceivedAt ?? orderDetail?.orderCreatedAt ?? order.updatedAt;
                const equipmentDisplay = getEquipmentNameDisplay(order, orderDetail ?? null, equipment);
                const pipeline = deriveOrderPipeline(order, orderDetail, equipment);
                const queueStatus = getOrderQueueStatusDisplay(order, pipeline);

                return (
                  <button
                    key={order.id}
                    type="button"
                    className={active ? `${styles.orderListItem} ${styles.orderListItemActive}` : styles.orderListItem}
                    aria-pressed={active}
                    aria-label={`選取 ${order.orderNumber}，${queueStatus.label}（品項：${pipeline.categoryName}，目前：${pipeline.currentStageName}）`}
                    onClick={() => handleSelectOrder(order)}
                  >
                    <span className={`${styles.statusPill} ${queueStatus.className}`}>
                      {queueStatus.label}
                    </span>
                    <span className={styles.orderItemInstitution} title={`${order.institutionName} · 設備：${equipmentDisplay}`}>
                      {order.institutionName}
                    </span>
                    <span className={styles.orderItemCart} title={order.cartNumber}>
                      🛒 {order.cartNumber}
                    </span>
                    <span
                      className={`${styles.orderItemCategoryBadge} ${styles[`categoryBadge_${pipeline.categoryTone}`]}`}
                      title={`洗滌分類品項：${pipeline.categoryName}`}
                    >
                      {pipeline.categoryName}
                    </span>
                    <div className={styles.orderItemPipeline} title={`目前階段：${pipeline.currentStageName}`}>
                      {pipeline.steps.map((step, idx) => {
                        const isStepPaused = step.status === "current" && pipeline.currentStageName.includes("暫停");
                        return (
                          <span key={step.order} className={styles.pipelineStepItem}>
                            <span
                              className={`${styles.pipelineChip} ${
                                step.status === "completed"
                                  ? styles.pipelineChipCompleted
                                  : isStepPaused
                                  ? styles.pipelineChipPaused
                                  : step.status === "current"
                                  ? styles.pipelineChipCurrent
                                  : styles.pipelineChipPending
                              }`}
                            >
                              {step.status === "completed" ? (
                                <span className={styles.chipCheck}>✓</span>
                              ) : isStepPaused ? (
                                <span className={styles.chipPulse}>⏸️</span>
                              ) : step.status === "current" ? (
                                <span className={styles.chipPulse}>⚡</span>
                              ) : (
                                <span className={styles.chipNum}>{step.order}</span>
                              )}
                              <span className={styles.chipName}>{step.name}</span>
                              {step.durationMinutes ? (
                                <span className={styles.chipTime}>{step.durationMinutes}m</span>
                              ) : null}
                            </span>
                            {idx < pipeline.steps.length - 1 ? (
                              <span className={styles.pipelineArrow}>➔</span>
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
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
              selected ? (
                selected.status === "ready_for_pickup" ? (
                  <AppLink
                    href={hrefWithClientScope(`/scan/pickup?cart=${selected.cartNumber}`, { siteId: siteId ?? null, institutionId: null })}
                    className={styles.orderFlowHeaderAction}
                  >
                    取件結案 ↗
                  </AppLink>
                ) : isOrderAtDisinfection ? (
                  <AppLink
                    href={hrefWithClientScope(
                      isSelectedStageRunning
                        ? `/app/operations/disinfection?mode=complete&order=${selected.orderNumber}&cart=${selected.cartNumber}&institution=${encodeURIComponent(selected.institutionName)}`
                        : `/app/operations/disinfection?order=${selected.orderNumber}&cart=${selected.cartNumber}&institution=${encodeURIComponent(selected.institutionName)}`,
                      { siteId: siteId ?? null, institutionId: null },
                    )}
                    className={styles.orderFlowHeaderAction}
                  >
                    {isSelectedStageRunning ? "消毒控制 ↗" : "開始消毒 ↗"}
                  </AppLink>
                ) : isOrderAtDrying ? (
                  <AppLink
                    href={hrefWithClientScope(
                      isSelectedStageRunning
                        ? `/app/operations/drying?mode=complete&order=${selected.orderNumber}&cart=${selected.cartNumber}&institution=${encodeURIComponent(selected.institutionName)}`
                        : `/app/operations/drying?order=${selected.orderNumber}&cart=${selected.cartNumber}&institution=${encodeURIComponent(selected.institutionName)}`,
                      { siteId: siteId ?? null, institutionId: null },
                    )}
                    className={styles.orderFlowHeaderAction}
                  >
                    {isSelectedStageRunning ? "烘衣控制 ↗" : "開始烘衣 ↗"}
                  </AppLink>
                ) : isOrderAtWashing ? (
                  <AppLink
                    href={hrefWithClientScope(
                      isSelectedStageRunning
                        ? `/app/operations/washing?mode=complete&order=${selected.orderNumber}&cart=${selected.cartNumber}&institution=${encodeURIComponent(selected.institutionName)}`
                        : `/app/operations/washing?order=${selected.orderNumber}&cart=${selected.cartNumber}&institution=${encodeURIComponent(selected.institutionName)}`,
                      { siteId: siteId ?? null, institutionId: null },
                    )}
                    className={styles.orderFlowHeaderAction}
                  >
                    {isSelectedStageRunning ? "清洗控制 ↗" : "開始清洗 ↗"}
                  </AppLink>
                ) : null
              ) : null
            }
          />
        ) : (
          <p className={styles.flowEmptyNotice}>選取一張洗衣單後，這裡會顯示目前允許的控制點與流程進度。</p>
        )}
      </div>
        </>
      ) : null}

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
