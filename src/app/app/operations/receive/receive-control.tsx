"use client";

import { useEffect, useState } from "react";

import { clearPendingQrToken } from "../../../scan/pending-qr-token";
import { ScanStage } from "../../scan-stage";
import { useQrFragment } from "../../use-qr-fragment";
import styles from "../../workspace.module.css";
import { PendingReceiptModal, type PendingReceiptOrder } from "./pending-receipt-modal";

type Category = { code: string; name: string };
type Result = { kind: "received" | "already-received"; batchCount: number; status: string } | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

const categoryEquipmentMap: Record<string, string[]> = {
  DISINFECT: ["消毒鍋", "洗衣機", "烘衣機"],
  BIB: ["洗衣機", "烘衣機"],
  SOILED: ["洗衣機", "烘衣機"],
  CURTAIN: ["洗衣機", "烘衣機"],
  OTHER: ["洗衣機", "烘衣機"],
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

export function ReceiveCartControl({ categories }: { categories: Category[] }) {
  const { token, missing } = useQrFragment("cart");
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manualReset, setManualReset] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PendingReceiptOrder | null>(null);
  const [pendingOrders, setPendingOrders] = useState<PendingReceiptOrder[]>([]);
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const activeToken = manualReset ? null : (selectedToken ?? token);
  const scanResult = result ?? (missing && !selectedToken && !manualReset ? { kind: "invalid" as const, reasonCode: "invalid_qr" } : null);

  useEffect(() => {
    let active = true;
    fetch("/api/operations/pending-receipts")
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!active || !data || !Array.isArray(data.orders)) return;
        setPendingOrders(data.orders);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const matchedOrder = pendingOrders.find((o) => o.qrToken === activeToken) ?? selectedOrder;
  const currentCartNumber = matchedOrder?.cartNumber;
  const currentInstitutionName = matchedOrder?.institutionName;

  const selectedCategoryObjects = categories.filter((c) => selected.includes(c.code));
  const selectedCategoryNames = selectedCategoryObjects.map((c) => c.name);
  const neededEquipment = Array.from(
    new Set(selected.flatMap((code) => categoryEquipmentMap[code] ?? ["洗衣機", "烘衣機"])),
  );
  const expectedEquipmentText =
    neededEquipment.length > 0
      ? neededEquipment.join("、")
      : "請先勾選洗滌分類";

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
      const response = await fetch("/api/operations/receive-cart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qr_token: activeToken, category_codes: selected, change_request_id: crypto.randomUUID() }) });
      const body = (await response.json()) as Result;
      if (body.kind === "denied" && (body.reasonCode === "order_not_receivable" || body.reasonCode === "invalid_qr")) {
        clearPendingQrToken("cart");
      }
      setResult(body);
    } catch { setResult({ kind: "failed", reasonCode: "service_unavailable" }); } finally { setSubmitting(false); }
  }

  function handleReset() {
    clearPendingQrToken("cart");
    setSelectedToken(null);
    setSelectedOrder(null);
    setManualReset(true);
    setResult(null);
    setSelected([]);
  }

  return (
    <div aria-live="polite">
      <ScanStage
        scanned={Boolean(activeToken)}
        waitingText="請掃描固定洗衣車 QR。"
        readyText="已掃描車卡，請選擇本車內容的洗滌分類。"
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
              {currentCartNumber || (activeToken ? "已載入車卡" : "待掃描車卡")}
            </strong>
          </div>
          <div>
            <span style={{ opacity: 0.8, fontSize: "0.82rem", display: "block", marginBottom: "0.2rem" }}>
              機構 (Institution)
            </span>
            <strong style={{ color: "#ffffff", fontSize: "1.05rem" }}>
              {currentInstitutionName || (activeToken ? "待確認機構" : "待掃描車卡")}
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
              使用設備名稱 (Equipment)
            </span>
            <strong style={{ color: selectedCategoryNames.length > 0 ? "#86efac" : "#cbd5e1", fontSize: "1.05rem" }}>
              {expectedEquipmentText}
            </strong>
          </div>
        </div>

        <fieldset>
          <legend>洗滌分類</legend>
          {categories.map((category) => (
            <label key={category.code} className={styles.checkboxLabel}>
              <input
                type="checkbox"
                value={category.code}
                checked={selected.includes(category.code)}
                onChange={(event) => setSelected((current) => event.target.checked ? [...current, category.code] : current.filter((code) => code !== category.code))}
              />
              <span>
                {category.name}（{category.code}）
                <small
                  style={{
                    marginLeft: "0.5rem",
                    fontSize: "0.82rem",
                    color: "rgba(255, 255, 255, 0.75)",
                    background: "rgba(0, 0, 0, 0.25)",
                    padding: "0.15rem 0.45rem",
                    borderRadius: "4px",
                  }}
                >
                  設備：{(categoryEquipmentMap[category.code] ?? ["洗衣機", "烘衣機"]).join("、")}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
          <button type="button" onClick={submit} disabled={!activeToken || submitting}>
            {submitting ? "收單中…" : "確認收單並建立批次"}
          </button>
          <button
            type="button"
            onClick={() => setPendingModalOpen(true)}
            style={{
              background: "var(--surface-subtle, #f0f7f4)",
              border: "1px solid var(--border-subtle, #bad7cc)",
              color: "var(--brand, #0f5b4c)",
              cursor: "pointer",
              padding: "0.5rem 1rem",
              borderRadius: "4px",
              fontWeight: 600,
            }}
          >
            📋 從待收單清單選取（免掃碼）
          </button>
          {activeToken ? (
            <button
              type="button"
              onClick={handleReset}
              style={{ background: "transparent", border: "1px solid var(--border-subtle, #ccc)", color: "inherit", cursor: "pointer", padding: "0.5rem 1rem", borderRadius: "4px" }}
            >
              清除此車卡 / 重新掃描其他車輛
            </button>
          ) : null}
        </div>
      </ScanStage>
      {scanResult?.kind === "received" || scanResult?.kind === "already-received" ? (
        <p className={styles.successNotice} role="status">
          {scanResult.kind === "already-received" ? "收單已確認" : "收單完成"}，已建立 {scanResult.batchCount} 個初始批次，狀態為待清洗。
        </p>
      ) : scanResult && "reasonCode" in scanResult ? (
        <div className={styles.errorNotice} role="alert">
          <p>{reasons[scanResult.reasonCode] ?? "收單沒有完成。"}</p>
          {scanResult.reasonCode === "invalid_qr" ? (
            <div style={{ marginTop: "0.5rem", fontSize: "0.9em" }}>
              <p style={{ margin: "0 0 0.5rem 0" }}>
                提示：目前尚未載入洗衣車卡。請使用手機掃描洗衣車 QR 碼，或直接從待收單清單選取：
              </p>
              <button
                type="button"
                onClick={() => setPendingModalOpen(true)}
                style={{
                  background: "#fff",
                  border: "1px solid #d88",
                  color: "#900",
                  cursor: "pointer",
                  padding: "0.35rem 0.75rem",
                  borderRadius: "4px",
                  fontWeight: 600,
                }}
              >
                📋 開啟待收單清單選取 ➔
              </button>
            </div>
          ) : null}
          {scanResult.reasonCode === "order_not_receivable" ? (
            <p style={{ marginTop: "0.5rem", fontSize: "0.9em" }}>
              提示：此車卡目前無待收件單。請先至「洗衣單與批次」確認待收單對應之洗衣車號並掃描該車卡，或為此車先進行送單。
            </p>
          ) : null}
        </div>
      ) : null}

      <PendingReceiptModal
        isOpen={pendingModalOpen}
        onClose={() => setPendingModalOpen(false)}
        onSelectOrder={handleSelectOrder}
      />
    </div>
  );
}
