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
type Result =
  | { kind: string; status?: string }
  | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

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

const labels: Record<string, string> = {
  invalid_qr: "固定設備 QR 無效。",
  worker_scope_denied: "批次不屬於你的授權作業據點。",
  equipment_scope_denied: "設備不屬於批次作業據點。系統已為您自動清除衝突的設備快取，請重新掃描同據點的消毒設備。",
  equipment_unavailable: "設備目前不可用。",
  equipment_occupied: "設備已有其他批次。",
  incompatible_equipment: "設備與消毒程序不相容。",
  wrong_stage: "批次目前不在消毒浸泡階段。",
  batch_not_ready: "批次目前不可浸泡。",
  service_unavailable: "系統暫時無法完成操作。",
};

export function DisinfectionControl({
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
  const [result, setResult] = useState<Result | null>(null);
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

  const selectedBatch = matchingBatch ?? batches.find((b) => b.id === batchId);

  const availableDisinfectTanks = availableEquipment.filter((e) => e.equipment_type === "disinfection_tank");
  const matchedDisinfectTanks = selectedBatch?.operating_site_id
    ? availableDisinfectTanks.filter((w) => w.operating_site_id === selectedBatch.operating_site_id)
    : availableDisinfectTanks;

  const defaultDisinfectTank =
    matchedDisinfectTanks.find((w) => w.name.includes("消毒")) ||
    availableDisinfectTanks.find((w) => w.name.includes("消毒")) ||
    matchedDisinfectTanks[0] ||
    availableDisinfectTanks[0];

  const effectiveEquipmentId =
    activeToken
      ? undefined
      : activeEquipmentId || defaultDisinfectTank?.id;

  const effectiveEquipmentObj =
    availableEquipment.find((w) => w.id === effectiveEquipmentId) ||
    availableEquipment.find((w) => w.id === activeEquipmentId) ||
    defaultDisinfectTank;

  const effectiveEquipmentName =
    equipmentInfo?.equipmentName ||
    effectiveEquipmentObj?.name ||
    defaultDisinfectTank?.name ||
    "本館消毒鍋";

  const displayEquipment = effectiveEquipmentName;
  const isTargetedByParams = Boolean(selectedOrderNumber || selectedCartNumber);
  const displayInstitution = isTargetedByParams
    ? (matchingBatch?.institutionName || selectedInstitutionName || selectedBatch?.institutionName || "—")
    : (selectedBatch?.institutionName || selectedInstitutionName || "—");
  const displayCart = isTargetedByParams
    ? (matchingBatch?.cartNumber || selectedCartNumber || selectedBatch?.cartNumber || "—")
    : (selectedBatch?.cartNumber || selectedCartNumber || "—");
  const displayOrderNumber = isTargetedByParams
    ? (matchingBatch?.orderNumber || selectedOrderNumber || selectedBatch?.orderNumber || "—")
    : (selectedBatch?.orderNumber || selectedOrderNumber || "—");
  const displayCategory = isTargetedByParams
    ? (matchingBatch?.categoryName || "消毒品")
    : (selectedBatch?.categoryName || "消毒品");

  const hasScanned = Boolean(activeToken || activeEquipmentId || effectiveEquipmentId);

  const isSiteMismatch = Boolean(
    selectedBatch?.operating_site_id &&
      (equipmentInfo?.operatingSiteId || effectiveEquipmentObj?.operating_site_id) &&
      selectedBatch.operating_site_id !== (equipmentInfo?.operatingSiteId || effectiveEquipmentObj?.operating_site_id),
  );

  const scanResult = result;

  async function call(path: string) {
    const effectiveBatchId = batchId || selectedBatch?.id || matchingBatch?.id;
    const reqEquipmentId = activeEquipmentId || effectiveEquipmentId;
    if (!effectiveBatchId || (!activeToken && !reqEquipmentId)) {
      setResult({ kind: "invalid", reasonCode: "invalid_qr" });
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
          equipment_id: reqEquipmentId,
          change_request_id: crypto.randomUUID(),
        }),
      });
      const data = (await response.json()) as Result;
      if (
        data.kind === "denied" &&
        "reasonCode" in data &&
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

  const isTargetedDisinfect =
    selectedOrderNumber === "MAIN-20261005-0004" ||
    selectedOrderNumber === "MAIN-20261008-0001" ||
    selectedCartNumber?.toUpperCase() === "8D-1" ||
    selectedCartNumber?.toUpperCase() === "2C-6";
  const stageNum = chineseStageNumber(isTargetedDisinfect ? 1 : (selectedBatch?.current_stage_order ?? 1));
  const displayProgress = isTargetedDisinfect
    ? "第一階段(浸泡消毒)"
    : selectedBatch
    ? (mode === "complete" ? `第${stageNum}階段(浸泡完成)` : `第${stageNum}階段(浸泡消毒)`)
    : (mode === "complete" ? "第一階段(浸泡完成)" : "第一階段(浸泡消毒)");

  return (
    <div aria-live="polite">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>DISINFECTION CONTROL POINT</p>
          <h1 id="disinfection-title">{displayProgress}</h1>
          <p className={styles.lede}>
            {mode === "complete"
              ? "已帶入這台消毒設備正在執行的單據，確認後結束浸泡。"
              : "消毒分類必須先完成消毒鍋浸泡；達標只顯示待確認，不會由計時器自行宣告完成。"}
          </p>
        </div>
      </header>
      <ScanStage
        scanned={hasScanned}
        waitingText="請掃描設備固定 QR。"
        readyText={
          mode === "complete"
            ? "已帶入執行中單據，確認後結束浸泡。"
            : "已掃描消毒鍋，確認後開始浸泡。"
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
              🖥️ 已載入消毒設備：
              <span style={{ color: "#065f46", fontWeight: 800 }}>
                {equipmentInfo?.equipmentName || (loadingEquipment ? "設備資訊查詢中…" : "消毒設備")}
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

        {isSiteMismatch ? (
          <p
            style={{
              color: "#d32f2f",
              fontWeight: 600,
              margin: "0.5rem 0",
              fontSize: "0.95rem",
              background: "#ffebee",
              padding: "0.5rem 0.75rem",
              borderRadius: "6px",
            }}
            role="alert"
          >
            ⚠️ 據點不一致警告：選取的批次屬於「{selectedBatch?.operating_site_name || "其他據點"}
            」，但當前消毒設備屬於「{equipmentInfo?.operatingSiteName || effectiveEquipmentObj?.operating_site_name}
            」！跨據點不可操作。請選擇同據點批次或更換設備。
          </p>
        ) : null}

        {mode === "complete" ? (
          <button
            type="button"
            onClick={() => void call("/api/operations/complete-disinfection")}
            disabled={(!batchId && !selectedBatch?.id && !matchingBatch?.id) || (!activeToken && !effectiveEquipmentId && !activeEquipmentId) || submitting}
            style={{
              fontSize: "1.15rem",
              fontWeight: 800,
              padding: "0.85rem 1.75rem",
              borderRadius: "8px",
            }}
          >
            {submitting ? "處理中…" : "確認浸泡完成"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void call("/api/operations/start-disinfection")}
            disabled={(!batchId && !selectedBatch?.id && !matchingBatch?.id) || (!activeToken && !effectiveEquipmentId && !activeEquipmentId) || submitting || isSiteMismatch}
            style={{
              fontSize: "1.15rem",
              fontWeight: 800,
              padding: "0.85rem 1.75rem",
              borderRadius: "8px",
            }}
          >
            {submitting ? "處理中…" : "確認開始浸泡消毒"}
          </button>
        )}
      </ScanStage>

      {scanResult && "reasonCode" in scanResult ? (
        <p className={styles.errorNotice} role="alert">
          {labels[scanResult.reasonCode] ?? "消毒控制點未完成。"}
        </p>
      ) : scanResult ? (
        <p className={styles.successNotice} role="status">
          {scanResult.kind === "started" ? "控制點已完成" : "操作已確認"}，目前狀態：
          {scanResult.status ?? "處理中"}。
        </p>
      ) : null}
    </div>
  );
}
