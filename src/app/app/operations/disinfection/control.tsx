"use client";
import { useState } from "react";
import { ScanStage } from "../../scan-stage";
import { useLiveBatches, usePreferredId } from "../../use-live-batches";
import { useQrFragment } from "../../use-qr-fragment";
import styles from "../../workspace.module.css";
import { formatBatchLabel, type ControlBatch } from "../batch-label";
type Batch = ControlBatch;
type Result = { kind: string; status?: string } | { kind: "invalid" | "denied" | "failed"; reasonCode: string };
const labels: Record<string, string> = { invalid_qr: "固定設備 QR 無效。", equipment_scope_denied: "設備不屬於批次作業據點。", equipment_unavailable: "設備目前不可用。", equipment_occupied: "設備已有其他批次。", incompatible_equipment: "設備與消毒程序不相容。", wrong_stage: "批次目前不在消毒浸泡階段。", batch_not_ready: "批次目前不可浸泡。", service_unavailable: "系統暫時無法完成操作。" };
export function DisinfectionControl({ batches: initial, siteId, mode = "start", focusedBatchId }: { batches: Batch[]; siteId?: string; mode?: "start" | "complete"; focusedBatchId?: string }) {
  const { batches } = useLiveBatches(initial, mode === "complete" ? ["in_progress"] : ["not_started"], siteId);
  const visible = focusedBatchId ? batches.filter((batch) => batch.id === focusedBatchId) : batches;
  const [batchId, setBatchId] = usePreferredId((visible.length > 0 ? visible : batches).map((batch) => batch.id)); const { token } = useQrFragment("equipment"); const [result, setResult] = useState<Result | null>(null); const [submitting, setSubmitting] = useState(false);
  const scanResult = result;
  async function call(path: string) { if (!batchId || !token) { setResult({ kind: "invalid", reasonCode: "invalid_qr" }); return; } setSubmitting(true); setResult(null); try { const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batch_id: batchId, qr_token: token, change_request_id: crypto.randomUUID() }) }); setResult((await response.json()) as Result); } catch { setResult({ kind: "failed", reasonCode: "service_unavailable" }); } finally { setSubmitting(false); } }
  return (
    <div aria-live="polite">
      <ScanStage
        scanned={Boolean(token)}
        waitingText="請掃描設備固定 QR。"
        readyText={mode === "complete" ? "已帶入執行中單據，確認後結束浸泡。" : "已掃描消毒鍋，確認後開始浸泡。"}
      >
        <label>
          {mode === "complete" ? "執行中單據" : "待浸泡批次"}
          <select value={batchId} onChange={(event) => setBatchId(event.target.value)} disabled={mode === "complete"}>
            {visible.length === 0 ? <option value="">{mode === "complete" ? "目前沒有這台消毒鍋的執行中單據" : "目前沒有待浸泡批次"}</option> : visible.map((batch) => (
              <option key={batch.id} value={batch.id}>{formatBatchLabel(batch)}</option>
            ))}
          </select>
        </label>
        {mode === "complete" ? (
          <button type="button" onClick={() => void call("/api/operations/complete-disinfection")} disabled={!batchId || !token || submitting}>確認浸泡完成</button>
        ) : (
          <button type="button" onClick={() => void call("/api/operations/start-disinfection")} disabled={!batchId || !token || submitting}>開始浸泡</button>
        )}
      </ScanStage>
      {scanResult && "reasonCode" in scanResult ? <p className={styles.errorNotice} role="alert">{labels[scanResult.reasonCode] ?? "消毒控制點未完成。"}</p> : scanResult ? <p className={styles.successNotice} role="status">{scanResult.kind === "started" ? "控制點已完成" : "操作已確認"}，目前狀態：{scanResult.status ?? "處理中"}。</p> : null}
    </div>
  );
}
