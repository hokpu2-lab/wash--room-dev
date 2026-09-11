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
}: LiveQueueProps) {
  const [selectedId, setSelectedId] = useState<string | null>(selectedOrderId ?? orders[0]?.id ?? null);
  const [detailOpen, setDetailOpen] = useState(false);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [fetchedDetail, setFetchedDetail] = useState<WorkspaceOrderDetail | null>(null);
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
                  onClick={() => setSelectedId(order.id)}
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

      <aside className={styles.inspector}>
        {selected || selectedDetail ? (
          <LaundryOrderFlow3D
            orderStatus={selected?.status ?? "in_process"}
            batches={selectedDetail?.batches ?? []}
            orderCreatedAt={selectedDetail?.orderCreatedAt}
            orderReceivedAt={selectedDetail?.orderReceivedAt}
            orderReadyAt={selectedDetail?.orderReadyAt}
            orderClosedAt={selectedDetail?.orderClosedAt}
            headerAction={(
              <button
                className={styles.orderFlowHeaderAction}
                type="button"
                onClick={() => setDetailOpen(true)}
              >
                前往目前控制點
              </button>
            )}
          />
        ) : (
          <p>選取一張洗衣單後，這裡會顯示目前允許的控制點。</p>
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
