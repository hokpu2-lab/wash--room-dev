"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { ScanStage } from "../../scan-stage";
import { useLiveBatches, usePreferredId } from "../../use-live-batches";
import { useQrFragment } from "../../use-qr-fragment";
import styles from "../../workspace.module.css";
import { formatBatchLabel, type ControlBatch } from "../batch-label";

type Batch = ControlBatch;
type Result = { kind: "started" | "already-started"; status: string } | { kind: "invalid" | "denied" | "failed"; reasonCode: string };
const reasons: Record<string, string> = {
  invalid_qr: "固定洗衣機 QR 無效或已撤銷。",
  worker_scope_denied: "批次不屬於你的授權作業據點。",
  equipment_scope_denied: "洗衣機不屬於批次作業據點。",
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
  const visible = focusedBatchId
    ? batches.filter((batch) => batch.id === focusedBatchId)
    : batches;
  const [batchId, setBatchId] = usePreferredId(
    (visible.length > 0 ? visible : batches).map((batch) => batch.id),
  );
  const { token } = useQrFragment("equipment");
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const equipmentId = useSearchParams().get("e");
  const scanResult = result;
  async function submit(path: string) {
    if (!batchId || (!token && !equipmentId)) { setResult({ kind: "invalid", reasonCode: "invalid_qr" }); return; }
    setSubmitting(true); setResult(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batch_id: batchId, qr_token: token, equipment_id: equipmentId, change_request_id: crypto.randomUUID() }) });
      setResult((await response.json()) as Result);
    } catch { setResult({ kind: "failed", reasonCode: "service_unavailable" }); } finally { setSubmitting(false); }
  }
  return (
    <div aria-live="polite">
      <ScanStage
        scanned={Boolean(token || equipmentId)}
        waitingText="請掃描洗衣機固定 QR。"
        readyText={mode === "complete" ? "已帶入執行中單據，確認後結束清洗。" : "已掃描洗衣機，確認後開始清洗。"}
      >
        <label>
          {mode === "complete" ? "執行中單據" : "待清洗批次"}
          <select
            value={batchId}
            onChange={(event) => setBatchId(event.target.value)}
            disabled={mode === "complete" || visible.length === 0}
          >
            {visible.length === 0 ? (
              <option value="">{mode === "complete" ? "目前沒有這台洗衣機的執行中單據" : "目前沒有待清洗批次"}</option>
            ) : visible.map((batch) => (
              <option key={batch.id} value={batch.id}>{formatBatchLabel(batch)}</option>
            ))}
          </select>
        </label>
        {mode === "complete" ? (
          <button type="button" onClick={() => void submit("/api/operations/complete-stage")} disabled={!batchId || !(token || equipmentId) || submitting}>
            {submitting ? "處理中…" : "確認清洗完成"}
          </button>
        ) : (
          <button type="button" onClick={() => void submit("/api/operations/start-washing")} disabled={!batchId || !(token || equipmentId) || submitting}>
            {submitting ? "處理中…" : "確認開始清洗"}
          </button>
        )}
      </ScanStage>
      {scanResult?.kind === "started" || scanResult?.kind === "already-started" ? (
        <p className={styles.successNotice} role="status">{scanResult.status === "not_started" || scanResult.status === "completed" ? "清洗已結束" : "清洗已開始"}。</p>
      ) : scanResult && "reasonCode" in scanResult ? (
        <p className={styles.errorNotice} role="alert">{reasons[scanResult.reasonCode] ?? "清洗沒有開始。"}</p>
      ) : null}
    </div>
  );
}
