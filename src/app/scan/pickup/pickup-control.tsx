"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../cart/scan.module.css";
import type { PickupCartInfoResult } from "@/lib/laundry-order/pickup";

const TOKEN_KEY = "wr_pending_cart_token";

function getSafeUUID(): string {
  try {
    if (
      typeof window !== "undefined" &&
      window.crypto &&
      typeof window.crypto.randomUUID === "function"
    ) {
      return window.crypto.randomUUID();
    }
  } catch {
    /* fallback */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
  const [actionError, setActionError] = useState<string | null>(null);
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
      const cleanCart = cartFromQuery.trim();
      setCartParam(cleanCart);
      setLoadingInfo(true);
      fetch(`/api/scan/pickup?cart=${encodeURIComponent(cleanCart)}`)
        .then((res) => res.json())
        .then((data: PickupCartInfoResult) => {
          setCartInfo(data);
          setLoadingInfo(false);
        })
        .catch(() => {
          setLoadingInfo(false);
          // 若查詢端點連線異常，依然給予一個以該車號為主的展示卡片，允許直接點擊取件結案
          setCartInfo({
            found: true,
            cartNumber: cleanCart,
            orderNumber: "查詢中",
            orderId: "",
            institutionName: "送洗機構",
            status: "ready_for_pickup",
            categoryNames: ["一般"],
            createdAt: new Date().toISOString(),
            readyAt: new Date().toISOString(),
          });
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
          change_request_id: getSafeUUID(),
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
    if (!targetCart || submitting) return;
    setSubmitting(true);
    setActionError(null);
    setResult(null);

    try {
      const reqId = getSafeUUID();
      const response = await fetch("/api/scan/pickup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cart_number: targetCart,
          change_request_id: reqId,
        }),
      });

      const data = await response.json();
      if (data.kind === "picked-up" || data.kind === "already-picked-up") {
        setResult(data);
      } else {
        const errMsg =
          data.reasonCode === "not_pickup_ready"
            ? "這台車目前尚無可結案之單據，或該單據洗滌仍在進行中。"
            : data.reasonCode === "cart_not_found"
            ? "系統中查無此車號，請核對車號。"
            : "取件結案處理未成功，請確認機台或單據狀態後重試。";
        setActionError(errMsg);
      }
    } catch (err) {
      console.error("取件結案失敗:", err);
      setActionError("網路連線或伺服器異常，請稍候重試。");
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
    setActionError(null);
    setResult(null);

    fetch(`/api/scan/pickup?cart=${encodeURIComponent(trimmed)}`)
      .then((res) => res.json())
      .then((data: PickupCartInfoResult) => {
        setCartInfo(data);
        setLoadingInfo(false);
      })
      .catch(() => {
        setLoadingInfo(false);
        setCartInfo({
          found: true,
          cartNumber: trimmed,
          orderNumber: "查詢中",
          orderId: "",
          institutionName: "送洗機構",
          status: "ready_for_pickup",
          categoryNames: ["一般"],
          createdAt: new Date().toISOString(),
          readyAt: new Date().toISOString(),
        });
      });
  };

  const effectiveCartNumber =
    cartParam || cartInfo?.cartNumber || result?.cartNumber || "—";

  return (
    <div aria-live="polite" style={{ marginTop: "1rem" }}>
      {/* 1. 取件成功狀態 */}
      {result?.kind === "picked-up" || result?.kind === "already-picked-up" ? (
        <div className={styles.success} role="status">
          <h2>✅ 取件完成</h2>
          <p>
            洗衣車號：<strong>{effectiveCartNumber}</strong>
          </p>
          <p>
            洗衣單編號：<strong>{result.orderNumber || "已結案"}</strong>
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

      {/* 2. 正在查詢單據資訊 */}
      {loadingInfo ? (
        <div className={styles.preview}>
          <p>⏳ 正在查詢車號「{cartParam}」的待取件單據…</p>
        </div>
      ) : null}

      {/* 3. 從看板點擊過來或查詢到車號資訊（結案前維持常駐顯示） */}
      {!result && !loadingInfo && (cartInfo?.found || cartParam) ? (
        <div
          className={styles.preview}
          style={{
            border: "2px solid #28755b",
            background: "#ffffff",
            boxShadow: "0 4px 12px rgba(40, 117, 91, 0.08)",
          }}
        >
          <p className={styles.identity}>📋 待領回洗衣車資訊</p>
          <div style={{ display: "grid", gap: "0.6rem", fontSize: "0.95rem" }}>
            <div>
              <strong>洗衣車號：</strong>
              <span
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 900,
                  color: "#102b27",
                  background: "#e3f4e8",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "6px",
                  marginLeft: "0.3rem",
                  display: "inline-block",
                }}
              >
                🛒 {effectiveCartNumber}
              </span>
            </div>
            {cartInfo?.found ? (
              <>
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
              </>
            ) : null}
            <div>
              <strong>目前階段：</strong>
              <span
                style={{
                  background: "#047857",
                  color: "#ecfdf5",
                  padding: "0.25rem 0.65rem",
                  borderRadius: "6px",
                  fontWeight: 800,
                  fontSize: "0.85rem",
                  display: "inline-block",
                }}
              >
                ✨ 洗烘完畢 · 待領回
              </span>
            </div>
          </div>

          {/* 錯誤提示框（若點選結案失敗） */}
          {actionError ? (
            <div
              className={styles.error}
              role="alert"
              style={{ marginTop: "1rem", padding: "0.75rem", fontSize: "0.9rem" }}
            >
              ⚠️ {actionError}
            </div>
          ) : null}

          <button
            type="button"
            className={styles.button}
            onClick={() => handleConfirmPickup(effectiveCartNumber)}
            disabled={submitting}
            style={{
              marginTop: "1.25rem",
              fontSize: "1.1rem",
              fontWeight: 800,
              background: submitting ? "#6b7280" : "#28755b",
              color: "#fff",
              cursor: submitting ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {submitting ? "⏳ 正在辦理取件結案中，請稍候…" : "👉 確認送洗人員領回 / 取件結案"}
          </button>

          <Link
            href="/app/dashboard"
            className={styles.secondary}
            style={{ textAlign: "center", textDecoration: "none", marginTop: "0.75rem" }}
          >
            返回即時看板
          </Link>
        </div>
      ) : null}

      {/* 4. 若無車號或查無單據，提供手動車號查詢輸入 */}
      {!result && !loadingInfo && !cartInfo?.found && !cartParam ? (
        <div style={{ marginTop: "1rem" }}>
          <form
            onSubmit={handleSearchCart}
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
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
