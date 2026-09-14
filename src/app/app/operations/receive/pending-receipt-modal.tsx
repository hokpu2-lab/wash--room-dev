"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { writePendingQrToken } from "@/app/scan/pending-qr-token";

import styles from "../../workspace.module.css";

export type PendingReceiptOrder = {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  institutionName: string;
  cartId: string;
  cartNumber: string;
  qrToken: string;
  receiveHref: string;
};

type PendingReceiptModalProps = {
  isOpen: boolean;
  onClose: () => void;
  siteId?: string;
  onSelectOrder?: (order: PendingReceiptOrder) => void;
};

export function PendingReceiptModal({
  isOpen,
  onClose,
  siteId,
  onSelectOrder,
}: PendingReceiptModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<PendingReceiptOrder[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    setLoading(true);
    setErrorMessage(null);

    const url = siteId
      ? `/api/operations/pending-receipts?siteId=${encodeURIComponent(siteId)}`
      : `/api/operations/pending-receipts`;

    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error("無法取得待收件單據清單");
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data.orders)) {
          setOrders(data.orders);
        } else {
          setOrders([]);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setErrorMessage(err instanceof Error ? err.message : "載入失敗，請稍後再試");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, siteId]);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  function handleSelect(order: PendingReceiptOrder) {
    writePendingQrToken("cart", order.qrToken);
    if (onSelectOrder) {
      onSelectOrder(order);
    }
    onClose();
    router.push(order.receiveHref);
  }

  return createPortal(
    <div
      className={styles.controlPointBackdrop}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={styles.controlPointModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-receipt-modal-title"
        style={{ maxWidth: "640px" }}
      >
        <button
          ref={closeButtonRef}
          className={styles.historyModalClose}
          type="button"
          onClick={onClose}
          aria-label="關閉"
        >
          ×
        </button>

        <header className={styles.pageHeader} style={{ marginBottom: "1.25rem" }}>
          <div>
            <p className={styles.eyebrow}>PENDING LAUNDRY ORDERS</p>
            <h2 id="pending-receipt-modal-title" style={{ margin: "0.25rem 0", fontSize: "1.35rem" }}>
              待洗衣員收單清單
            </h2>
            <p className={styles.lede} style={{ margin: 0, fontSize: "0.95rem" }}>
              點選欲處理的洗衣單，系統將自動載入該車卡憑證並前往分類收單。
            </p>
          </div>
        </header>

        {loading ? (
          <p style={{ padding: "1.5rem 0", textAlign: "center", color: "var(--muted, #666)" }}>
            正在載入待收件洗衣單…
          </p>
        ) : errorMessage ? (
          <div className={styles.errorNotice} role="alert">
            <p>{errorMessage}</p>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ padding: "2rem 1rem", textAlign: "center", background: "var(--surface-subtle, #f5f8f7)", borderRadius: "8px" }}>
            <p style={{ margin: 0, fontWeight: 600 }}>目前沒有待收件的洗衣單</p>
            <small style={{ color: "var(--muted, #666)" }}>所有已送單的洗衣車皆已完成現場收單與批次建立。</small>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "420px", overflowY: "auto" }}>
            {orders.map((order) => {
              const formattedDate = new Date(order.createdAt).toLocaleString("zh-TW", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <div
                  key={order.orderId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.85rem 1.15rem",
                    border: "1px solid var(--border-subtle, #d8e6e0)",
                    borderRadius: "10px",
                    background: "#ffffff",
                    transition: "border-color 0.15s ease",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                      <strong style={{ fontSize: "1.05rem", color: "var(--brand, #0f5b4c)" }}>
                        {order.orderNumber}
                      </strong>
                      <span
                        style={{
                          fontSize: "0.8rem",
                          padding: "0.15rem 0.5rem",
                          borderRadius: "4px",
                          background: "#eef6f3",
                          color: "#165a4a",
                          fontWeight: 600,
                        }}
                      >
                        {order.cartNumber}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#555" }}>
                      <span>{order.institutionName}</span> · <time>{formattedDate} 送單</time>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSelect(order)}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "6px",
                      background: "var(--brand, #0f5b4c)",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                    }}
                  >
                    載入此單收單 →
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
