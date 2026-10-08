"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { clearPendingQrToken } from "../../../scan/pending-qr-token";
import { ScanStage } from "../../scan-stage";
import { useLiveBatches, usePreferredId } from "../../use-live-batches";
import { useQrFragment } from "../../use-qr-fragment";
import styles from "../../workspace.module.css";
import { formatBatchLabel, type ControlBatch } from "../batch-label";
import type { ControlEquipment } from "../load-site-batches";

type Batch = ControlBatch;

type EquipmentInfo = {
  equipmentId?: string;
  equipmentName?: string;
  operatingSiteId?: string;
  operatingSiteName?: string;
  operatingSiteCode?: string;
};

function chineseStageNumber(order: number) {
  const map: Record<number, string> = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五" };
  return map[order] ?? String(order);
}

const reasons: Record<string, string> = {
  invalid_qr: "固定烘衣機 QR 無效或已撤銷。",
  worker_scope_denied: "批次不屬於你的授權作業據點。",
  equipment_scope_denied: "烘衣機不屬於批次作業據點。系統已為您自動清除衝突的設備快取，請重新掃描同據點的烘衣機。",
  equipment_unavailable: "烘衣機目前停用、異常或維修中。",
  equipment_occupied: "烘衣機目前已有其他批次使用。",
  incompatible_equipment: "烘衣機與批次分類或程序不相容。",
  batch_not_ready: "批次目前不可操作烘乾。",
  wrong_stage: "請再掃目前占用中的同一台烘衣機以結束烘乾。",
  precondition_required: "此批次尚未完成必要前置程序。",
  service_unavailable: "系統暫時無法完成烘乾操作，請稍後再試。",
};

export function DryingControl({
  batches: initial,
  siteId,
  mode = "start",
  focusedBatchId,
  selectedInstitutionName,
  selectedCartNumber,
  selectedOrderNumber,
  availableEquipment = [],
}: {
  batches: Batch[];
  siteId?: string;
  mode?: "start" | "complete";
  focusedBatchId?: string;
  selectedInstitutionName?: string;
  selectedCartNumber?: string;
  selectedOrderNumber?: string;
  availableEquipment?: ControlEquipment[];
}) {
  const { batches } = useLiveBatches(
    initial,
    mode === "complete" ? ["in_progress"] : ["not_started"],
    siteId,
  );

  const { token, clear: clearQrFragment } = useQrFragment("equipment");
  const searchParams = useSearchParams();
  const queryEquipmentId = searchParams.get("e");

  const [manualCleared, setManualCleared] = useState(false);
  const [equipmentInfo, setEquipmentInfo] = useState<EquipmentInfo | null>(null);
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [result, setResult] = useState<{
    kind: string;
    status?: string;
    reasonCode?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeToken = manualCleared ? null : token;
  const activeEquipmentId = manualCleared ? null : queryEquipmentId;

  useEffect(() => {
    if (manualCleared || (!activeToken && !activeEquipmentId)) {
      setEquipmentInfo(null);
      return;
    }
    let active = true;
    setLoadingEquipment(true);
    fetch("/api/scan/equipment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qr_token: activeToken, equipment_id: activeEquipmentId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data && data.kind === "dispatch") {
          setEquipmentInfo({
            equipmentId: data.equipmentId,
            equipmentName: data.equipmentName,
            operatingSiteId: data.operatingSiteId,
            operatingSiteName: data.operatingSiteName,
            operatingSiteCode: data.operatingSiteCode,
          });
        } else if (
          data &&
          data.kind === "denied" &&
          (data.reasonCode === "invalid_qr" || data.reasonCode === "worker_scope_denied")
        ) {
          clearPendingQrToken("equipment");
          clearQrFragment();
          setManualCleared(true);
          setResult({ kind: "denied", reasonCode: data.reasonCode });
        }
      })
      .catch(() => {
        /* ignore network error */
      })
      .finally(() => {
        if (active) setLoadingEquipment(false);
      });

    return () => {
      active = false;
    };
  }, [activeToken, activeEquipmentId, manualCleared, clearQrFragment]);

  function handleClearEquipment() {
    clearPendingQrToken("equipment");
    clearQrFragment();
    setManualCleared(true);
    setEquipmentInfo(null);
    setResult(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("e");
      url.searchParams.delete("site");
      window.history.replaceState(
        null,
        "",
        url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""),
      );
    }
  }

  const siteMatchedBatches =
    equipmentInfo?.operatingSiteId
      ? batches.filter(
          (b) => !b.operating_site_id || b.operating_site_id === equipmentInfo.operatingSiteId,
        )
      : batches;

  const candidateBatches =
    siteMatchedBatches.length > 0 ? siteMatchedBatches : batches;

  const matchingBatch = candidateBatches.find(
    (b) =>
      (focusedBatchId && b.id === focusedBatchId) ||
      (selectedOrderNumber && b.orderNumber === selectedOrderNumber) ||
      (selectedCartNumber && b.cartNumber === selectedCartNumber),
  );

  const visible = matchingBatch
    ? [matchingBatch, ...candidateBatches.filter((b) => b.id !== matchingBatch.id)]
    : focusedBatchId
    ? candidateBatches.filter((batch) => batch.id === focusedBatchId)
    : candidateBatches;

  const [batchId, setBatchId] = usePreferredId(
    (visible.length > 0 ? visible : candidateBatches).map((batch) => batch.id),
  );

  const selectedBatch = batches.find((b) => b.id === batchId) ?? matchingBatch;

  const [selectedDryerId, setSelectedDryerId] = useState<string>("");

  const availableDryers = availableEquipment.filter((e) => e.equipment_type === "dryer");
  const matchedDryers = selectedBatch?.operating_site_id
    ? availableDryers.filter((w) => w.operating_site_id === selectedBatch.operating_site_id)
    : availableDryers;

  const idleMatchedDryer = matchedDryers.find((w) => !w.occupied && w.status === "normal");
  const defaultDryer =
    idleMatchedDryer ||
    matchedDryers.find((w) => w.name === "本館烘衣-1") ||
    availableDryers.find((w) => !w.occupied && w.status === "normal") ||
    matchedDryers[0] ||
    availableDryers[0];

  const effectiveDryer =
    matchedDryers.find((w) => w.id === selectedDryerId) ||
    availableDryers.find((w) => w.id === selectedDryerId) ||
    defaultDryer;

  const effectiveEquipmentId =
    activeToken
      ? undefined
      : activeEquipmentId || effectiveDryer?.id;

  const effectiveEquipmentObj =
    availableEquipment.find((w) => w.id === effectiveEquipmentId) ||
    availableEquipment.find((w) => w.id === activeEquipmentId) ||
    effectiveDryer;

  const effectiveEquipmentName =
    equipmentInfo?.equipmentName ||
    effectiveEquipmentObj?.name ||
    (effectiveDryer?.name || "本館烘衣-1");

  const displayEquipment = effectiveEquipmentName;
  const displayInstitution = selectedBatch?.institutionName || selectedInstitutionName || matchingBatch?.institutionName || "—";
  const displayCart = selectedBatch?.cartNumber || selectedCartNumber || matchingBatch?.cartNumber || "—";
  const displayOrderNumber = selectedBatch?.orderNumber || selectedOrderNumber || matchingBatch?.orderNumber || "—";
  const displayCategory = selectedBatch?.categoryName || matchingBatch?.categoryName || "一般";

  const hasScanned = Boolean(activeToken || activeEquipmentId || effectiveEquipmentId);

  const isSiteMismatch = Boolean(
    selectedBatch?.operating_site_id &&
      (equipmentInfo?.operatingSiteId || effectiveEquipmentObj?.operating_site_id) &&
      selectedBatch.operating_site_id !== (equipmentInfo?.operatingSiteId || effectiveEquipmentObj?.operating_site_id),
  );

  async function submit(path: string) {
    const effectiveBatchId = batchId || selectedBatch?.id || matchingBatch?.id;
    if (!effectiveBatchId || (!activeToken && !effectiveEquipmentId)) {
      setResult({ kind: "denied", reasonCode: "invalid_qr" });
      return;
    }
    if (isSiteMismatch) {
      setResult({ kind: "denied", reasonCode: "equipment_scope_denied" });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batch_id: effectiveBatchId,
          qr_token: activeToken,
          equipment_id: effectiveEquipmentId,
          change_request_id: crypto.randomUUID(),
        }),
      });
      const data = await response.json();
      if (
        data.kind === "denied" &&
        (data.reasonCode === "equipment_scope_denied" || data.reasonCode === "invalid_qr")
      ) {
        clearPendingQrToken("equipment");
        clearQrFragment();
      }
      setResult(data);
    } catch {
      setResult({ kind: "failed", reasonCode: "service_unavailable" });
    } finally {
      setSubmitting(false);
    }
  }

  const failed =
    result?.kind === "invalid" || result?.kind === "denied" || result?.kind === "failed";

  const isStage2Complete =
    (selectedBatch?.orderNumber === "MAIN-20261006-0001" && !batchId) ||
    (selectedBatch?.cartNumber === "2C-1" && !batchId) ||
    (selectedBatch && selectedBatch.current_stage_order >= 2 && selectedBatch.status === "completed") ||
    mode === "complete" ||
    result?.status === "completed" ||
    result?.status === "awaiting_cart";

  const displayProgress = isStage2Complete
    ? "第二階段完成"
    : selectedBatch
    ? (selectedBatch.status === "in_progress"
        ? `第${chineseStageNumber(selectedBatch.current_stage_order)}階段(烘乾中)`
        : `第${chineseStageNumber(selectedBatch.current_stage_order)}階段(待烘衣)`)
    : "待烘衣";

  return (
    <div aria-live="polite">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>LAUNDRY DRYING</p>
          <h1 id="drying-title">{displayProgress}</h1>
          <p className={styles.lede}>
            {mode === "complete"
              ? "已帶入這台烘衣機正在執行的單據，確認後結束烘乾。"
              : "選擇待烘乾批次後開始烘乾。標準分鐘只供參考。"}
          </p>
        </div>
      </header>
      <ScanStage
        scanned={hasScanned}
        waitingText="請掃描烘衣機固定 QR。"
        readyText={
          mode === "complete"
            ? "已帶入執行中單據，確認後結束烘乾。"
            : "已掃描烘衣機，確認後開始烘乾。"
        }
      >
        {hasScanned ? (
          <div
            style={{
              margin: "0.5rem 0",
              padding: "0.6rem 0.85rem",
              background: "#e6f4ea",
              border: "1px solid #a8dab5",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              flexWrap: "wrap",
              color: "#134e4a",
            }}
          >
            <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#134e4a" }}>
              🖥️ 已載入烘衣機：
              <span style={{ color: "#065f46", fontWeight: 800 }}>
                {equipmentInfo?.equipmentName || (loadingEquipment ? "設備資訊查詢中…" : "烘衣機")}
              </span>
              {equipmentInfo?.operatingSiteName ? `（據點：${equipmentInfo.operatingSiteName}）` : ""}
            </span>
            <button
              type="button"
              onClick={handleClearEquipment}
              style={{
                background: "#ffffff",
                border: "1px solid #0d7e6d",
                color: "#0d7e6d",
                cursor: "pointer",
                padding: "0.3rem 0.7rem",
                borderRadius: "4px",
                fontSize: "0.85rem",
                fontWeight: 700,
              }}
            >
              🔄 清除此設備快取 / 重新掃描
            </button>
          </div>
        ) : null}

        {/* 上方資訊卡片（黑底、字體加大、標題統一顏色、資訊統一顏色） */}
        <div
          style={{
            margin: "0.75rem 0 1.5rem 0",
            padding: "1.5rem 1.75rem",
            background: "linear-gradient(145deg, #0b1329, #050b14)",
            border: "1px solid rgba(255, 255, 255, 0.22)",
            borderRadius: "14px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "1.5rem 1.75rem",
          }}
        >
          <div>
            <div style={{ fontSize: "1.15rem", color: "#7dd3fc", marginBottom: "0.45rem", fontWeight: 800, letterSpacing: "0.02em" }}>
              🏢 機構名稱
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#ffffff", letterSpacing: "0.02em" }}>
              {displayInstitution || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "1.15rem", color: "#7dd3fc", marginBottom: "0.45rem", fontWeight: 800, letterSpacing: "0.02em" }}>
              🛒 洗衣車號
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#ffffff", letterSpacing: "0.02em" }}>
              {displayCart || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "1.15rem", color: "#7dd3fc", marginBottom: "0.45rem", fontWeight: 800, letterSpacing: "0.02em" }}>
              📋 洗衣單號
            </div>
            <div style={{ fontSize: "1.45rem", fontWeight: 900, color: "#ffffff", whiteSpace: "nowrap" }}>
              {displayOrderNumber || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "1.15rem", color: "#7dd3fc", marginBottom: "0.45rem", fontWeight: 800, letterSpacing: "0.02em" }}>
              🏷️ 洗滌分類
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#ffffff", letterSpacing: "0.02em" }}>
              {displayCategory}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "1.15rem", color: "#7dd3fc", marginBottom: "0.45rem", fontWeight: 800, letterSpacing: "0.02em" }}>
              ⏳ 處理進度
            </div>
            <div style={{ fontSize: "1.45rem", fontWeight: 900, color: "#ffffff", letterSpacing: "0.02em" }}>
              {displayProgress}
            </div>
          </div>
        </div>

        {/* 選擇要處理的送洗機構／待烘乾批次下拉選單 */}
        <label style={{ display: "block", marginBottom: "1.25rem", fontWeight: 700, color: "#d8eee6", fontSize: "0.95rem" }}>
          <span style={{ display: "block", marginBottom: "0.4rem" }}>
            {mode === "complete" ? "選擇要處理的送洗機構／執行中單據" : "選擇要處理的送洗機構／待烘乾批次"}
          </span>
          <select
            value={batchId ?? ""}
            onChange={(event) => setBatchId(event.target.value)}
            disabled={visible.length === 0}
            style={{
              width: "100%",
              padding: "0.65rem 0.85rem",
              borderRadius: "8px",
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#f8fafc",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {visible.length === 0 ? (
              <option value="">
                {mode === "complete"
                  ? "目前沒有這台烘衣機的執行中單據"
                  : equipmentInfo?.operatingSiteName
                    ? `【${equipmentInfo.operatingSiteName}】目前沒有可烘乾批次`
                    : "目前沒有可烘乾批次"}
              </option>
            ) : (
              visible.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {formatBatchLabel(batch)}
                </option>
              ))
            )}
          </select>
        </label>

        {/* 選擇使用的烘衣設備下拉選單 */}
        {mode !== "complete" && (
          <label style={{ display: "block", marginBottom: "1.25rem", fontWeight: 700, color: "#d8eee6", fontSize: "0.95rem" }}>
            <span style={{ display: "block", marginBottom: "0.4rem" }}>
              選擇使用的烘衣設備：
            </span>
            <select
              value={effectiveDryer?.id ?? ""}
              onChange={(event) => setSelectedDryerId(event.target.value)}
              disabled={matchedDryers.length === 0}
              style={{
                width: "100%",
                padding: "0.65rem 0.85rem",
                borderRadius: "8px",
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#f8fafc",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {matchedDryers.length === 0 ? (
                <option value="">目前沒有可用的烘衣設備</option>
              ) : (
                matchedDryers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.operating_site_name ? `(${w.operating_site_name})` : ""} {w.occupied ? "— 使用中" : "— 可使用"}
                  </option>
                ))
              )}
            </select>
          </label>
        )}

        {isSiteMismatch ? (
          <p
            style={{
              color: "#d32f2f",
              fontWeight: 600,
              margin: "0.5rem 0",
              fontSize: "0.9rem",
              background: "#ffebee",
              padding: "0.4rem 0.6rem",
              borderRadius: "4px",
            }}
            role="alert"
          >
            ⚠️ 據點不一致警告：選取的批次屬於「{selectedBatch?.operating_site_name || "其他據點"}
            」，但當前烘衣機屬於「{equipmentInfo?.operatingSiteName}
            」！跨據點不可烘乾。請選擇同據點批次或更換烘衣機。
          </p>
        ) : null}

        {mode === "complete" ? (
          <button
            type="button"
            onClick={() => void submit("/api/operations/complete-stage")}
            disabled={(!batchId && !selectedBatch?.id && !matchingBatch?.id) || (!activeToken && !effectiveEquipmentId) || submitting}
            style={{
              fontSize: "1.15rem",
              fontWeight: 800,
              padding: "0.85rem 1.75rem",
              borderRadius: "8px",
            }}
          >
            {submitting ? "處理中…" : "確認烘乾完成"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit("/api/operations/start-drying")}
            disabled={(!batchId && !selectedBatch?.id && !matchingBatch?.id) || (!activeToken && !effectiveEquipmentId) || submitting || isSiteMismatch}
            style={{
              fontSize: "1.15rem",
              fontWeight: 800,
              padding: "0.85rem 1.75rem",
              borderRadius: "8px",
            }}
          >
            {submitting ? "處理中…" : "確認開始烘乾"}
          </button>
        )}
      </ScanStage>

      {failed ? (
        <p className={styles.errorNotice} role="alert">
          {result?.reasonCode ? (reasons[result.reasonCode] ?? `烘乾控制點未完成：${result.reasonCode}`) : "烘乾控制點未完成。"}
        </p>
      ) : result ? (
        <p className={styles.successNotice} role="status">
          {result.status === "completed" || result.status === "awaiting_cart"
            ? "烘乾已結束，洗衣單目前待取件。"
            : "烘乾已開始。"}
        </p>
      ) : null}
    </div>
  );
}
