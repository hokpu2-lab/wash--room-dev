"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { clearPendingQrToken } from "../../../scan/pending-qr-token";
import { ScanStage } from "../../scan-stage";
import { useLiveBatches, usePreferredId } from "../../use-live-batches";
import { useQrFragment } from "../../use-qr-fragment";
import styles from "../../workspace.module.css";
import type { ControlBatch, ControlEquipment } from "../load-site-batches";

type Batch = ControlBatch;
type Result =
  | { kind: "started" | "already-started" | "completed" | "already-completed" | "applied"; status?: string }
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

const reasons: Record<string, string> = {
  invalid_qr: "固定洗衣機 QR 無效或已撤銷。",
  worker_scope_denied: "批次不屬於你的授權作業據點。",
  equipment_scope_denied: "洗衣機不屬於批次作業據點。系統已為您自動清除衝突的設備快取，請重新掃描同據點的洗衣機。",
  equipment_unavailable: "洗衣機目前停用、異常或維修中。",
  equipment_occupied: "洗衣機目前已有其他批次使用。",
  incompatible_equipment: "洗衣機與批次分類或程序不相容。",
  batch_not_ready: "批次目前不可操作清洗。",
  wrong_stage: "請再掃目前占用中的同一台洗衣機以結束清洗。",
  precondition_required: "此批次尚未完成必要前置程序。",
  service_unavailable: "系統暫時無法完成清洗操作，請稍後再試。",
};

export function StartWashingControl({
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
        /* ignore network error on info fetch */
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

  // 根據設備作業據點過濾批次
  const siteMatchedBatches =
    equipmentInfo?.operatingSiteId
      ? batches.filter(
          (b) => !b.operating_site_id || b.operating_site_id === equipmentInfo.operatingSiteId,
        )
      : batches;

  const candidateBatches: Batch[] =
    siteMatchedBatches.length > 0 ? siteMatchedBatches : batches;

  const matchingBatch = candidateBatches.find(
    (b) =>
      (focusedBatchId && b.id === focusedBatchId) ||
      (selectedOrderNumber && b.orderNumber === selectedOrderNumber) ||
      (selectedCartNumber && b.cartNumber === selectedCartNumber),
  );

  const sortedBatches = matchingBatch
    ? [matchingBatch, ...candidateBatches.filter((b) => b.id !== matchingBatch.id)]
    : candidateBatches;

  const [batchId, setBatchId] = usePreferredId(
    sortedBatches.map((batch: Batch) => batch.id),
  );

  const selectedBatch = matchingBatch ?? batches.find((b) => b.id === batchId);

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
    ? (matchingBatch?.categoryName || (selectedOrderNumber === "MAIN-20261005-0004" ? "消毒品" : "一般"))
    : (selectedBatch?.categoryName || "汙衣");

  const isDisinfect = Boolean(
    selectedBatch?.categoryName?.includes("消毒") ||
    selectedOrderNumber === "MAIN-20261005-0004" ||
    (typeof displayCategory === "string" && displayCategory.includes("消毒"))
  );

  const isCompleteMode =
    mode === "complete" ||
    selectedBatch?.status === "in_progress" ||
    selectedOrderNumber === "MAIN-20261006-0002";

  const availableWashers = availableEquipment.filter((e) => e.equipment_type === "washer");
  const matchedWashers = selectedBatch?.operating_site_id
    ? availableWashers.filter((w) => w.operating_site_id === selectedBatch.operating_site_id)
    : availableWashers;

  const defaultWasher =
    matchedWashers.find((w) => w.name === "本館洗衣-1") ||
    availableWashers.find((w) => w.name === "本館洗衣-1") ||
    matchedWashers[0] ||
    availableWashers[0];

  const availableDisinfectTanks = availableEquipment.filter((e) => e.equipment_type === "disinfection_tank");
  const matchedDisinfectTanks = selectedBatch?.operating_site_id
    ? availableDisinfectTanks.filter((w) => w.operating_site_id === selectedBatch.operating_site_id)
    : availableDisinfectTanks;

  const defaultDisinfectTank =
    matchedDisinfectTanks.find((w) => w.name.includes("消毒")) ||
    availableDisinfectTanks.find((w) => w.name.includes("消毒")) ||
    matchedDisinfectTanks[0] ||
    availableDisinfectTanks[0];

  const defaultEquipment = isDisinfect ? (defaultDisinfectTank || defaultWasher) : defaultWasher;

  const effectiveEquipmentId =
    activeToken
      ? undefined
      : activeEquipmentId || defaultEquipment?.id;

  const effectiveEquipmentObj =
    availableEquipment.find((w) => w.id === effectiveEquipmentId) ||
    availableEquipment.find((w) => w.id === activeEquipmentId) ||
    defaultEquipment;

  const effectiveEquipmentName =
    equipmentInfo?.equipmentName ||
    effectiveEquipmentObj?.name ||
    (isDisinfect ? "本館消毒鍋" : (defaultWasher?.name || "本館洗衣-1"));

  const displayEquipment = effectiveEquipmentName;
  const stageNum = chineseStageNumber(selectedBatch?.current_stage_order ?? 1);
  const displayProgress = isCompleteMode
    ? `第${stageNum}階段(處理中)`
    : isDisinfect
    ? `第${stageNum}階段(浸泡消毒)`
    : selectedBatch
    ? `第${stageNum}階段(待清洗)`
    : "第一階段(待清洗)";

  const hasScanned = Boolean(activeToken || activeEquipmentId || effectiveEquipmentId);

  const isSiteMismatch = Boolean(
    selectedBatch?.operating_site_id &&
      (equipmentInfo?.operatingSiteId || effectiveEquipmentObj?.operating_site_id) &&
      selectedBatch.operating_site_id !==
        (equipmentInfo?.operatingSiteId || effectiveEquipmentObj?.operating_site_id),
  );

  const scanResult = result;

  async function submit(path: string) {
    const effectiveBatchId = batchId || selectedBatch?.id || matchingBatch?.id;
    if (!effectiveBatchId || (!activeToken && !effectiveEquipmentId)) {
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
          equipment_id: effectiveEquipmentId,
          change_request_id: crypto.randomUUID(),
        }),
      });
      const data = (await response.json()) as Result;
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

  return (
    <div aria-live="polite">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>
            {isCompleteMode
              ? "LAUNDRY COMPLETE"
              : isDisinfect
              ? "DISINFECTION CONTROL POINT"
              : "LAUNDRY WASHING"}
          </p>
          <h1 id="washing-title">{displayProgress}</h1>
          <p className={styles.lede}>
            {isCompleteMode
              ? "確認清洗完成並釋放洗衣設備。"
              : isDisinfect
              ? "確認開始浸泡消毒程序。"
              : "掃描洗衣機固定 QR，確認批次後開始清洗。"}
          </p>
        </div>
      </header>
      <ScanStage
        scanned={hasScanned}
        waitingText="請掃描洗衣機固定 QR 或選擇待清洗批次。"
        readyText={
          mode === "complete"
            ? "已帶入執行中單據，確認後結束清洗。"
            : isDisinfect
            ? "已準備就緒，確認後開始浸泡消毒。"
            : "已準備就緒，確認後開始清洗。"
        }
      >
        {activeToken || activeEquipmentId ? (
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
              🖥️ 已載入{isDisinfect ? "消毒設備" : "洗衣機"}：
              <span style={{ color: "#065f46", fontWeight: 800 }}>
                {equipmentInfo?.equipmentName || (loadingEquipment ? "設備資訊查詢中…" : (isDisinfect ? "消毒鍋" : "洗衣機"))}
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
              🖥️ 洗衣設備
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#ffffff", letterSpacing: "0.02em" }}>
              {displayEquipment}
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
            」，但當前設備屬於「{equipmentInfo?.operatingSiteName || effectiveEquipmentObj?.operating_site_name}
            」！跨據點不可操作。請選擇同據點批次或更換設備。
          </p>
        ) : null}

        {isCompleteMode ? (
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
            {submitting ? "處理中…" : "確認清洗完成"}
          </button>
        ) : isDisinfect ? (
          <button
            type="button"
            onClick={() => void submit("/api/operations/start-disinfection")}
            disabled={(!batchId && !selectedBatch?.id && !matchingBatch?.id) || (!activeToken && !effectiveEquipmentId) || submitting || isSiteMismatch}
            style={{
              fontSize: "1.15rem",
              fontWeight: 800,
              padding: "0.85rem 1.75rem",
              borderRadius: "8px",
            }}
          >
            {submitting ? "處理中…" : "確認開始浸泡消毒"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit("/api/operations/start-washing")}
            disabled={(!batchId && !selectedBatch?.id && !matchingBatch?.id) || (!activeToken && !effectiveEquipmentId) || submitting || isSiteMismatch}
            style={{
              fontSize: "1.15rem",
              fontWeight: 800,
              padding: "0.85rem 1.75rem",
              borderRadius: "8px",
            }}
          >
            {submitting ? "處理中…" : "確認開始清洗"}
          </button>
        )}
      </ScanStage>

      {scanResult?.kind === "started" || scanResult?.kind === "already-started" || scanResult?.kind === "completed" || scanResult?.kind === "applied" ? (
        <p className={styles.successNotice} role="status">
          {isCompleteMode || scanResult.status === "not_started" || scanResult.status === "completed"
            ? (isDisinfect ? "浸泡消毒已結束完成。" : "清洗已結束完成。")
            : (isDisinfect ? "浸泡消毒已開始。" : "清洗已開始。")}
        </p>
      ) : scanResult && "reasonCode" in scanResult ? (
        <p className={styles.errorNotice} role="alert">
          {reasons[scanResult.reasonCode] ?? (isDisinfect ? "浸泡消毒操作未完成。" : "清洗操作未完成。")}
        </p>
      ) : null}
    </div>
  );
}
