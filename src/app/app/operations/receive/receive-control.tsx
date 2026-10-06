"use client";

import { useEffect, useState } from "react";

import { clearPendingQrToken } from "../../../scan/pending-qr-token";
import { ScanStage } from "../../scan-stage";
import { useQrFragment } from "../../use-qr-fragment";
import styles from "../../workspace.module.css";
import { PendingReceiptModal, type PendingReceiptOrder } from "./pending-receipt-modal";

type Category = { code: string; name: string };
type Result = { kind: "received" | "already-received"; batchCount: number; status: string } | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

export type AvailableEquipment = {
  id: string;
  name: string;
  equipmentType: "disinfection_tank" | "washer" | "dryer" | string;
  operatingSiteId?: string;
  occupied: boolean;
  status: string;
};

const categoryEquipmentMap: Record<string, string[]> = {
  DISINFECT: ["消毒鍋", "洗衣機", "烘衣機"],
  BIB: ["洗衣機", "烘衣機"],
  SOILED: ["洗衣機", "烘衣機"],
  CURTAIN: ["洗衣機", "烘衣機"],
  OTHER: ["洗衣機", "烘衣機"],
};

const categoryEquipmentTypeMap: Record<string, string[]> = {
  DISINFECT: ["disinfection_tank", "washer", "dryer"],
  BIB: ["washer", "dryer"],
  SOILED: ["washer", "dryer"],
  CURTAIN: ["washer", "dryer"],
  OTHER: ["washer", "dryer"],
};

const reasons: Record<string, string> = {
  invalid_qr: "固定車卡 QR 無效或已撤銷。",
  worker_scope_denied: "這張洗衣車不屬於你的授權作業據點。",
  inactive_cart: "洗衣車目前停用。",
  order_not_receivable: "這台車目前沒有待收件洗衣單。",
  invalid_categories: "請至少選擇一個啟用分類。",
  incompatible_category: "選取的分類目前不可用。",
  missing_published_procedure: "選取分類尚未有已發布程序，請聯絡洗衣主管。",
  request_replay: "這次收單操作無法重複使用。",
  service_unavailable: "系統暫時無法收單，請稍後再試。",
};

export function ReceiveCartControl({
  categories,
  initialEquipment = [],
}: {
  categories: Category[];
  initialEquipment?: AvailableEquipment[];
}) {
  const { token, missing } = useQrFragment("cart");
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manualReset, setManualReset] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PendingReceiptOrder | null>(null);
  const [pendingOrders, setPendingOrders] = useState<PendingReceiptOrder[]>([]);
  const [equipmentList, setEquipmentList] = useState<AvailableEquipment[]>(initialEquipment);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const activeToken = manualReset ? null : (selectedToken ?? token);
  const scanResult = result ?? (missing && !selectedToken && !manualReset ? { kind: "invalid" as const, reasonCode: "invalid_qr" } : null);

  useEffect(() => {
    let active = true;
    setLoadingOrders(true);
    fetch("/api/operations/pending-receipts")
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data) return;
        if (Array.isArray(data.orders)) setPendingOrders(data.orders);
        if (Array.isArray(data.equipment)) setEquipmentList(data.equipment);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingOrders(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const matchedOrder = pendingOrders.find((o) => o.qrToken === activeToken) ?? selectedOrder;
  const currentCartNumber = matchedOrder?.cartNumber;
  const currentInstitutionName = matchedOrder?.institutionName;
  const currentOrderNumber = matchedOrder?.orderNumber;

  const selectedCategoryObjects = categories.filter((c) => selected.includes(c.code));
  const selectedCategoryNames = selectedCategoryObjects.map((c) => c.name);

  // 所需設備類型（例如 washer, dryer, disinfection_tank）
  const neededEquipmentTypes = Array.from(
    new Set(selected.flatMap((code) => categoryEquipmentTypeMap[code] ?? ["washer", "dryer"])),
  );

  // 依待收單據據點（若有）過濾同據點設備，避免跨據點設備混入
  const isCorpOrder =
    matchedOrder?.orderNumber?.startsWith("CORP") ||
    matchedOrder?.institutionName?.includes("法人");

  const siteScopedEquipment = equipmentList.filter((e) => {
    if (isCorpOrder) {
      return (
        e.name.includes("法人") ||
        e.name.startsWith("CORP") ||
        (e.operatingSiteId && e.operatingSiteId.includes("CORP"))
      );
    }
    // 預設為本館或非法人設備
    return (
      e.name.includes("本館") ||
      e.name.startsWith("MAIN") ||
      (!e.name.includes("法人") && !e.name.startsWith("CORP"))
    );
  });

  // 閒置中的可用設備（occupied 為 false 且狀態為 normal）
  const idleEquipment = siteScopedEquipment.filter((e) => !e.occupied && e.status === "normal");

  // 匹配當前所選分類所需類型的閒置設備
  const matchingIdleEquipment = idleEquipment.filter((e) =>
    neededEquipmentTypes.includes(e.equipmentType),
  );
  const idleEquipmentNames = matchingIdleEquipment.map((e) => e.name);

  const fallbackTypeText = Array.from(
    new Set(selected.flatMap((code) => categoryEquipmentMap[code] ?? ["洗衣機", "烘衣機"])),
  ).join("、");

  const expectedEquipmentText =
    selectedCategoryNames.length === 0
      ? "請先勾選洗滌分類"
      : idleEquipmentNames.length > 0
      ? idleEquipmentNames.join("、")
      : `${fallbackTypeText}（目前無閒置設備）`;

  function handleSelectOrder(order: PendingReceiptOrder) {
    setSelectedToken(order.qrToken);
    setSelectedOrder(order);
    setManualReset(false);
    setResult(null);
  }

  async function submit() {
    if (!activeToken || selected.length === 0) { setResult({ kind: "invalid", reasonCode: "invalid_categories" }); return; }
    setSubmitting(true); setResult(null);
    try {
      const response = await fetch("/api/operations/receive-cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          qr_token: activeToken,
          category_codes: selected,
          change_request_id: crypto.randomUUID(),
        }),
      });
      const body = (await response.json()) as Result;
      if (body.kind === "received" || body.kind === "already-received") {
        if (activeToken) {
          setPendingOrders((prev) => prev.filter((o) => o.qrToken !== activeToken));
        }
      }
      if (body.kind === "denied" && (body.reasonCode === "order_not_receivable" || body.reasonCode === "invalid_qr")) {
        clearPendingQrToken("cart");
        if (activeToken) {
          setPendingOrders((prev) => prev.filter((o) => o.qrToken !== activeToken));
        }
      }
      setResult(body);
    } catch {
      setResult({ kind: "failed", reasonCode: "service_unavailable" });
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    clearPendingQrToken("cart");
    if (scanResult?.kind === "received" || scanResult?.kind === "already-received") {
      if (activeToken) {
        setPendingOrders((prev) => prev.filter((o) => o.qrToken !== activeToken));
      }
    }
    setSelectedToken(null);
    setSelectedOrder(null);
    setManualReset(true);
    setResult(null);
    setSelected([]);
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    fetch("/api/operations/pending-receipts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.orders)) {
          setPendingOrders(data.orders);
        }
        if (data && Array.isArray(data.equipment)) {
          setEquipmentList(data.equipment);
        }
      })
      .catch(() => {});
  }

  // 待收單清單先顯示
  if (!activeToken) {
    return (
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div
          style={{
            background: "linear-gradient(135deg, #ffffff 0%, #f0f7f4 100%)",
            border: "1px solid var(--border-subtle, #bad7cc)",
            borderRadius: "14px",
            padding: "1.25rem 1.5rem",
            boxShadow: "0 4px 16px rgba(15, 91, 76, 0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.25rem", color: "var(--brand, #0f5b4c)", fontWeight: 800 }}>
                📋 待洗衣員收單清單
              </h2>
              <p style={{ margin: "0.25rem 0 0 0", color: "#55716a", fontSize: "0.9rem" }}>
                請點選欲處理的洗衣單以進入洗滌分類與收單，或掃描洗衣車 QR 碼自動進入。
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoadingOrders(true);
                fetch("/api/operations/pending-receipts")
                  .then((res) => res.json())
                  .then((data) => {
                    if (data && Array.isArray(data.orders)) setPendingOrders(data.orders);
                  })
                  .catch(() => {})
                  .finally(() => setLoadingOrders(false));
              }}
              style={{
                background: "#ffffff",
                border: "1px solid #cfdfd9",
                borderRadius: "6px",
                padding: "0.4rem 0.8rem",
                color: "#165a4a",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              🔄 重新整理
            </button>
          </div>

          {loadingOrders ? (
            <div style={{ padding: "2.5rem 0", textAlign: "center", color: "#666" }}>
              <p>正在載入待收件洗衣單…</p>
            </div>
          ) : pendingOrders.length === 0 ? (
            <div
              style={{
                padding: "2.5rem 1.5rem",
                textAlign: "center",
                background: "rgba(255, 255, 255, 0.6)",
                borderRadius: "10px",
                border: "1px dashed #cbd5e1",
              }}
            >
              <p style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#334155" }}>
                目前沒有待收件的洗衣單
              </p>
              <small style={{ color: "#64748b", marginTop: "0.35rem", display: "block" }}>
                所有已送單之洗衣車皆已完成現場收單與批次建立。
              </small>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 1.2fr 1fr 1.3fr 1.5fr 140px",
                  gap: "0.75rem",
                  padding: "0.5rem 1rem",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "#55716a",
                  borderBottom: "1px solid #d8e6e0",
                }}
              >
                <span>狀態</span>
                <span>機構</span>
                <span>車號</span>
                <span>送單時間</span>
                <span>洗衣單號</span>
                <span style={{ textAlign: "right" }}>操作</span>
              </div>

              {pendingOrders.map((order) => {
                const formattedDate = new Date(order.createdAt).toLocaleString("zh-TW", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <div
                    key={order.orderId}
                    onClick={() => handleSelectOrder(order)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "70px 1.2fr 1fr 1.3fr 1.5fr 140px",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem 1rem",
                      background: "#ffffff",
                      border: "1px solid #d8e6e0",
                      borderRadius: "8px",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "#168167";
                      e.currentTarget.style.boxShadow = "0 2px 8px rgba(18, 103, 82, 0.12)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "#d8e6e0";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div>
                      <span className={`${styles.statusPill} ${styles.statusPillGray}`}>
                        待收件
                      </span>
                    </div>
                    <strong style={{ color: "var(--brand, #0f5b4c)", fontSize: "0.95rem" }}>
                      {order.institutionName}
                    </strong>
                    <div>
                      <span
                        style={{
                          fontWeight: 700,
                          color: "#165a4a",
                          background: "#eef6f3",
                          padding: "0.2rem 0.55rem",
                          borderRadius: "4px",
                          fontSize: "0.9rem",
                        }}
                      >
                        {order.cartNumber}
                      </span>
                    </div>
                    <span style={{ color: "#555", fontSize: "0.88rem" }}>
                      {formattedDate}
                    </span>
                    <strong style={{ color: "#334155", fontSize: "0.92rem", wordBreak: "break-all" }}>
                      {order.orderNumber}
                    </strong>
                    <div style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectOrder(order);
                        }}
                        style={{
                          padding: "0.4rem 0.85rem",
                          borderRadius: "6px",
                          background: "var(--brand, #0f5b4c)",
                          color: "#fff",
                          border: "none",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: "0.85rem",
                          whiteSpace: "nowrap",
                        }}
                      >
                        選取分類收單 →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div aria-live="polite">
      <div style={{ marginBottom: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          type="button"
          onClick={handleReset}
          style={{
            background: "transparent",
            border: "1px solid var(--border-subtle, #bad7cc)",
            color: "var(--brand, #0f5b4c)",
            cursor: "pointer",
            padding: "0.4rem 0.8rem",
            borderRadius: "6px",
            fontWeight: 600,
            fontSize: "0.88rem",
          }}
        >
          ← 返回待收單清單（重選車輛）
        </button>
      </div>

      <ScanStage
        scanned={Boolean(activeToken)}
        waitingText="請掃描固定洗衣車 QR。"
        readyText="已載入待收單洗衣車，請選擇本車內容的洗滌分類。"
      >
        <div
          style={{
            margin: "0.5rem 0 1rem 0",
            padding: "0.75rem 1rem",
            background: "rgba(255, 255, 255, 0.08)",
            border: "1px solid rgba(255, 255, 255, 0.18)",
            borderRadius: "8px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "0.75rem 1rem",
            fontSize: "0.92rem",
          }}
        >
          <div>
            <span style={{ opacity: 0.8, fontSize: "0.82rem", display: "block", marginBottom: "0.2rem" }}>
              車號 (Vehicle)
            </span>
            <strong style={{ color: "#ffffff", fontSize: "1.05rem" }}>
              {currentCartNumber || "已載入車卡"}
            </strong>
          </div>
          <div>
            <span style={{ opacity: 0.8, fontSize: "0.82rem", display: "block", marginBottom: "0.2rem" }}>
              機構 (Institution)
            </span>
            <strong style={{ color: "#ffffff", fontSize: "1.05rem" }}>
              {currentInstitutionName || "待確認機構"}
            </strong>
          </div>
          <div>
            <span style={{ opacity: 0.8, fontSize: "0.82rem", display: "block", marginBottom: "0.2rem" }}>
              所選分類 (Categories)
            </span>
            <strong style={{ color: selectedCategoryNames.length > 0 ? "var(--accent-glow, #a5f3fc)" : "#cbd5e1", fontSize: "1.05rem" }}>
              {selectedCategoryNames.length > 0 ? selectedCategoryNames.join("、") : "未選取分類"}
            </strong>
          </div>
          <div>
            <span style={{ opacity: 0.8, fontSize: "0.82rem", display: "block", marginBottom: "0.2rem" }}>
              <a
                href="/app/admin/laundry-equipment"
                style={{ color: "#7dd3fc", textDecoration: "underline", fontWeight: 700 }}
                title="前往目前設備清單檢視狀態與固定 QR"
              >
                使用設備名稱 (Equipment) ↗
              </a>
            </span>
            <a
              href="/app/admin/laundry-equipment"
              style={{
                color: selectedCategoryNames.length > 0 ? "#86efac" : "#cbd5e1",
                fontSize: "1.05rem",
                fontWeight: 700,
                textDecoration: "none",
                display: "block",
                lineHeight: 1.4,
              }}
              title="點擊前往設備清單"
            >
              {expectedEquipmentText}
            </a>
          </div>
        </div>

        <fieldset>
          <legend>洗滌分類</legend>
          {categories.map((category) => (
            <label key={category.code} className={styles.checkboxLabel}>
              <input
                type="radio"
                name="receiveCategory"
                value={category.code}
                checked={selected.includes(category.code)}
                onChange={() => setSelected([category.code])}
              />
              <span>
                {category.name}（{category.code}）
              </span>
            </label>
          ))}
        </fieldset>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
          <button type="button" onClick={submit} disabled={!activeToken || submitting || selected.length === 0}>
            {submitting ? "收單中…" : "確認收單並建立批次"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            style={{ background: "transparent", border: "1px solid var(--border-subtle, #ccc)", color: "inherit", cursor: "pointer", padding: "0.5rem 1rem", borderRadius: "4px" }}
          >
            ← 返回待收單清單
          </button>
        </div>
      </ScanStage>

      {scanResult?.kind === "received" || scanResult?.kind === "already-received" ? (
        <div style={{ marginTop: "1rem" }}>
          <p className={styles.successNotice} role="status">
            {scanResult.kind === "already-received" ? "收單已確認" : "收單完成"}，已建立 {scanResult.batchCount} 個初始批次，狀態為待清洗。
          </p>
          <button
            type="button"
            onClick={handleReset}
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              background: "var(--brand, #0f5b4c)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            📋 繼續處理其他待收單 →
          </button>
        </div>
      ) : scanResult && "reasonCode" in scanResult ? (
        <div className={styles.errorNotice} role="alert" style={{ marginTop: "1rem" }}>
          <p>{reasons[scanResult.reasonCode] ?? "收單沒有完成。"}</p>
          {scanResult.reasonCode === "order_not_receivable" ? (
            <p style={{ marginTop: "0.5rem", fontSize: "0.9em" }}>
              提示：此車卡目前無待收件單。請先返回清單確認待收單對應之洗衣車號。
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleReset}
            style={{
              marginTop: "0.5rem",
              padding: "0.4rem 0.8rem",
              borderRadius: "4px",
              background: "#fff",
              border: "1px solid #d88",
              color: "#900",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ← 返回待收單清單
          </button>
        </div>
      ) : null}
    </div>
  );
}
