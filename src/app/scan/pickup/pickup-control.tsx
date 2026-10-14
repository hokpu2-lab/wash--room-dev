"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../cart/scan.module.css";
import type { PickupCartInfoResult } from "@/lib/laundry-order/pickup";

const TOKEN_KEY = "wr_pending_cart_token";

function readPickupToken() {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.slice(1);
  const match = /^v1\.cart\.(wrq_v1\.[^.]+\.[^.]+)$/.exec(hash);
  if (match) return match[1];
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearPendingToken() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function PickupControl() {
  const [cartParam, setCartParam] = useState<string | null>(null);
  const [cartInfo, setCartInfo] = useState<PickupCartInfoResult | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [result, setResult] = useState<{
    kind: string;
    orderNumber?: string;
    status?: string;
    reasonCode?: string;
    cartNumber?: string;
  } | null>(null);

  // 初始化讀取 URL 參數與 token
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const cartFromQuery = searchParams.get("cart");
    const qrToken = readPickupToken();

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`
    );
    clearPendingToken();

    if (cartFromQuery) {
      setCartParam(cartFromQuery);
      setLoadingInfo(true);
      fetch(`/api/scan/pickup?cart=${encodeURIComponent(cartFromQuery)}`)
        .then((res) => res.json())
        .then((data: PickupCartInfoResult) => {
          setCartInfo(data);
          setLoadingInfo(false);
        })
        .catch(() => {
          setLoadingInfo(false);
          setResult({ kind: "failed", reasonCode: "service_unavailable" });
        });
      return;
    }

    if (qrToken) {
      // 掃描固定 QR 自動取件
      setSubmitting(true);
      fetch("/api/scan/pickup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          qr_token: qrToken,
          change_request_id: crypto.randomUUID(),
        }),
      })
        .then(async (response) => setResult(await response.json()))
        .catch(() => setResult({ kind: "failed", reasonCode: "service_unavailable" }))
        .finally(() => setSubmitting(false));
      return;
    }
  }, []);

  // 依車號送出取件結案
  const handleConfirmPickup = async (targetCart: string) => {
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch("/api/scan/pickup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cart_number: targetCart,
          change_request_id: crypto.randomUUID(),
        }),
      });
      const data = await response.json();
      setResult(data);
    } catch {
      setResult({ kind: "failed", reasonCode: "service_unavailable" });
    } finally {
      setSubmitting(false);
    }
  };

  // 手動查詢車號
  const handleSearchCart = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualInput.trim();
    if (!trimmed) return;
    setCartParam(trimmed);
    setLoadingInfo(true);
    setResult(null);
    fetch(`/api/scan/pickup?cart=${encodeURIComponent(trimmed)}`)
      .then((res) => res.json())
      .then((data: PickupCartInfoResult) => {
        setCartInfo(data);
        setLoadingInfo(false);
      })
      .catch(() => {
        setLoadingInfo(false);
        setResult({ kind: "failed", reasonCode: "service_unavailable" });
      });
  };

  return (
    <div aria-live="polite" style={{ marginTop: "1rem" }}>
      {/* 1. 取件成功狀態 */}
      {result?.kind === "picked-up" || result?.kind === "already-picked-up" ? (
        <div className={styles.success} role="status">
          <h2>✅ 取件完成</h2>
          <p>
            洗衣車號：
            <strong>{result.cartNumber || cartParam || cartInfo?.cartNumber || "—"}</strong>
          </p>
          <p>
            洗衣單編號：<strong>{result.orderNumber}</strong>
          </p>
          <p>目前狀態：已取件 (送洗人員領回)。</p>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
            <Link
              href="/app/dashboard"
              className={styles.button}
              style={{ textAlign: "center", textDecoration: "none", flex: 1 }}
            >
              返回即時看板
            </Link>
            <Link
              href="/app"
              className={styles.secondary}
              style={{ textAlign: "center", textDecoration: "none", flex: 1 }}
            >
              回到首頁
            </Link>
          </div>
        </div>
      ) : null}

      {/* 2. 錯誤或無法取件提示 */}
      {result && result.kind !== "picked-up" && result.kind !== "already-picked-up" ? (
        <div className={styles.error} role="alert">
          <h2>目前無法取件</h2>
          <p>
            {result.reasonCode === "not_pickup_ready"
              ? "這台車目前沒有可取件洗衣單，或該單據洗滌尚未完成。"
              : result.reasonCode === "cart_not_found"
              ? "查無此洗衣車號，請檢查車號是否正確。"
              : "固定車卡 QR 無效或目前不可取件。"}
          </p>
          <div style={{ marginTop: "1rem" }}>
            <Link
              href="/app/dashboard"
              className={styles.secondary}
              style={{ textAlign: "center", textDecoration: "none", display: "inline-block" }}
            >
              返回即時看板
            </Link>
          </div>
        </div>
      ) : null}

      {/* 3. 正在載入車號資訊或執行結案 */}
      {loadingInfo ? (
        <div className={styles.preview}>
          <p>⏳ 正在查詢車號「{cartParam}」的待取件單據…</p>
        </div>
      ) : submitting ? (
        <div className={styles.preview}>
          <p>⏳ 正在為洗衣車辦理取件結案…</p>
        </div>
      ) : null}

      {/* 4. 從看板點擊過來，查到待取件資訊 */}
      {!result && !loadingInfo && !submitting && cartInfo?.found ? (
        <div className={styles.preview} style={{ border: "2px solid #28755b" }}>
          <p className={styles.identity}>📋 待領回洗衣車資訊</p>
          <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.95rem" }}>
            <div>
              <strong>洗衣車號：</strong>
              <span style={{ fontSize: "1.2rem", fontWeight: 800, color: "#102b27" }}>
                🛒 {cartInfo.cartNumber}
              </span>
            </div>
            <div>
              <strong>洗衣單編號：</strong>
              <span>{cartInfo.orderNumber}</span>
            </div>
            <div>
              <strong>送洗機構：</strong>
              <span>{cartInfo.institutionName}</span>
            </div>
            <div>
              <strong>洗滌分類：</strong>
              <span>{cartInfo.categoryNames.join("、")}</span>
            </div>
            <div>
              <strong>目前狀態：</strong>
              <span
                style={{
                  background: "#e3f4e8",
                  color: "#1e5e3a",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "4px",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                }}
              >
                洗烘完畢 · 待領回
              </span>
            </div>
          </div>

          <button
            type="button"
            className={styles.button}
            onClick={() => handleConfirmPickup(cartInfo.cartNumber)}
            style={{
              marginTop: "1.25rem",
              fontSize: "1.05rem",
              background: "#28755b",
              color: "#fff",
            }}
          >
            👉 確認送洗人員領回 / 取件結案
          </button>

          <Link
            href="/app/dashboard"
            className={styles.secondary}
            style={{ textAlign: "center", textDecoration: "none", marginTop: "0.5rem" }}
          >
            返回即時看板
          </Link>
        </div>
      ) : null}

      {/* 5. 若無車號或未查到，提供手動車號查詢輸入 */}
      {!result && !loadingInfo && !submitting && !cartInfo?.found && !cartParam ? (
        <div style={{ marginTop: "1rem" }}>
          <form onSubmit={handleSearchCart} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <label htmlFor="cart-search-input" style={{ fontWeight: 600, fontSize: "0.95rem" }}>
              輸入欲取件之洗衣車號：
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                id="cart-search-input"
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="例如：6D-1"
                style={{
                  flex: 1,
                  padding: "0.6rem 0.8rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #cbded4",
                  fontSize: "1rem",
                }}
              />
              <button
                type="submit"
                className={styles.button}
                style={{ width: "auto", minHeight: "auto", padding: "0.6rem 1.25rem", margin: 0 }}
              >
                查詢車輛
              </button>
            </div>
          </form>

          <div style={{ marginTop: "1.5rem" }}>
            <Link
              href="/app/dashboard"
              className={styles.secondary}
              style={{ textAlign: "center", textDecoration: "none" }}
            >
              返回即時看板
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
