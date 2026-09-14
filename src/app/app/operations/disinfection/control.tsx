"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { clearPendingQrToken } from "../../../scan/pending-qr-token";
import { ScanStage } from "../../scan-stage";
import { useLiveBatches, usePreferredId } from "../../use-live-batches";
import { useQrFragment } from "../../use-qr-fragment";
import styles from "../../workspace.module.css";
import { formatBatchLabel, type ControlBatch } from "../batch-label";

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
}: {
  batches: Batch[];
  siteId?: string;
  mode?: "start" | "complete";
  focusedBatchId?: string;
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
  const hasScanned = Boolean(activeToken || activeEquipmentId);

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

  const visible = focusedBatchId
    ? candidateBatches.filter((batch) => batch.id === focusedBatchId)
    : candidateBatches;

  const [batchId, setBatchId] = usePreferredId(
    (visible.length > 0 ? visible : candidateBatches).map((batch) => batch.id),
  );

  const selectedBatch = batches.find((b) => b.id === batchId);
  const isSiteMismatch = Boolean(
    selectedBatch?.operating_site_id &&
      equipmentInfo?.operatingSiteId &&
      selectedBatch.operating_site_id !== equipmentInfo.operatingSiteId,
  );

  const scanResult = result;

  async function call(path: string) {
    if (!batchId || (!activeToken && !activeEquipmentId)) {
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
          batch_id: batchId,
          qr_token: activeToken,
          equipment_id: activeEquipmentId,
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

  return (
    <div aria-live="polite">
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
              padding: "0.5rem 0.75rem",
              background: "var(--surface-subtle, #f0f7f4)",
              border: "1px solid var(--border-subtle, #bad7cc)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
              🖥️ 已載入消毒設備：
              {equipmentInfo?.equipmentName || (loadingEquipment ? "設備資訊查詢中…" : "消毒設備")}
              {equipmentInfo?.operatingSiteName ? `（據點：${equipmentInfo.operatingSiteName}）` : ""}
            </span>
            <button
              type="button"
              onClick={handleClearEquipment}
              style={{
                background: "transparent",
                border: "1px solid var(--border-subtle, #ccc)",
                color: "inherit",
                cursor: "pointer",
                padding: "0.25rem 0.6rem",
                borderRadius: "4px",
                fontSize: "0.85rem",
              }}
            >
              🔄 清除此設備快取 / 重新掃描
            </button>
          </div>
        ) : null}

        <label>
          {mode === "complete" ? "執行中單據" : "待浸泡批次"}
          <select
            value={batchId}
            onChange={(event) => setBatchId(event.target.value)}
            disabled={mode === "complete" || visible.length === 0}
          >
            {visible.length === 0 ? (
              <option value="">
                {mode === "complete"
                  ? "目前沒有這台消毒鍋的執行中單據"
                  : equipmentInfo?.operatingSiteName
                    ? `【${equipmentInfo.operatingSiteName}】目前沒有待浸泡批次`
                    : "目前沒有待浸泡批次"}
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
            」，但當前消毒設備屬於「{equipmentInfo?.operatingSiteName}
            」！跨據點不可操作。請選擇同據點批次或更換設備。
          </p>
        ) : null}

        {mode === "complete" ? (
          <button
            type="button"
            onClick={() => void call("/api/operations/complete-disinfection")}
            disabled={!batchId || !hasScanned || submitting}
          >
            {submitting ? "處理中…" : "確認浸泡完成"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void call("/api/operations/start-disinfection")}
            disabled={!batchId || !hasScanned || submitting || isSiteMismatch}
          >
            {submitting ? "處理中…" : "開始浸泡"}
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
