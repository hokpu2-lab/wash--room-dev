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
  | { kind: "started" | "already-started"; status: string }
  | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

type EquipmentInfo = {
  equipmentId?: string;
  equipmentName?: string;
  operatingSiteId?: string;
  operatingSiteName?: string;
  operatingSiteCode?: string;
};

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

  const sortedBatches = focusedBatchId
    ? [...candidateBatches].sort((a, b) => (a.id === focusedBatchId ? -1 : b.id === focusedBatchId ? 1 : 0))
    : candidateBatches;

  const [batchId, setBatchId] = usePreferredId(
    sortedBatches.map((batch: Batch) => batch.id),
  );

  const selectedBatch = batches.find((b) => b.id === batchId);

  const availableWashers = availableEquipment.filter((e) => e.equipment_type === "washer");
  const matchedWashers = selectedBatch?.operating_site_id
    ? availableWashers.filter((w) => w.operating_site_id === selectedBatch.operating_site_id)
    : availableWashers;

  const effectiveEquipmentId =
    activeToken
      ? undefined
      : activeEquipmentId || matchedWashers[0]?.id || availableWashers[0]?.id;

  const effectiveEquipmentObj =
    availableWashers.find((w) => w.id === effectiveEquipmentId) ||
    availableWashers.find((w) => w.id === activeEquipmentId);

  const effectiveEquipmentName =
    equipmentInfo?.equipmentName ||
    effectiveEquipmentObj?.name ||
    matchedWashers[0]?.name ||
    availableWashers[0]?.name ||
    "本館洗衣-1";

  const displayEquipment = effectiveEquipmentName;
  const displayInstitution = selectedBatch?.institutionName || selectedInstitutionName;
  const displayCart = selectedBatch?.cartNumber || selectedCartNumber;
  const displayOrderNumber = selectedBatch?.orderNumber || selectedOrderNumber;

  const hasScanned = Boolean(activeToken || activeEquipmentId || effectiveEquipmentId);

  const isSiteMismatch = Boolean(
    selectedBatch?.operating_site_id &&
      (equipmentInfo?.operatingSiteId || effectiveEquipmentObj?.operating_site_id) &&
      selectedBatch.operating_site_id !==
        (equipmentInfo?.operatingSiteId || effectiveEquipmentObj?.operating_site_id),
  );

  const scanResult = result;

  async function submit(path: string) {
    if (!batchId || (!activeToken && !effectiveEquipmentId)) {
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
      <ScanStage
        scanned={hasScanned}
        waitingText="請掃描洗衣機固定 QR 或選擇待清洗批次。"
        readyText={
          mode === "complete"
            ? "已帶入執行中單據，確認後結束清洗。"
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
              🖥️ 已載入洗衣機：
              <span style={{ color: "#065f46", fontWeight: 800 }}>
                {equipmentInfo?.equipmentName || (loadingEquipment ? "設備資訊查詢中…" : "洗衣機")}
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

        {/* 上方資訊卡片（字體加大、高對比清晰呈現） */}
        <div
          style={{
            margin: "0.75rem 0 1.25rem 0",
            padding: "1.25rem 1.5rem",
            background: "linear-gradient(145deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "12px",
            boxShadow: "0 6px 16px rgba(0, 0, 0, 0.3)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "1.25rem",
          }}
        >
          <div>
            <div style={{ fontSize: "1rem", color: "#94a3b8", marginBottom: "0.35rem", fontWeight: 700 }}>
              🏢 機構名稱
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#ffffff", letterSpacing: "0.02em" }}>
              {displayInstitution || "未指定"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "1rem", color: "#94a3b8", marginBottom: "0.35rem", fontWeight: 700 }}>
              🛒 洗衣車號
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#38bdf8", letterSpacing: "0.02em" }}>
              {displayCart || "未指定"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "1rem", color: "#94a3b8", marginBottom: "0.35rem", fontWeight: 700 }}>
              📋 洗衣單號
            </div>
            <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#f1f5f9", wordBreak: "break-all" }}>
              {displayOrderNumber || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "1rem", color: "#94a3b8", marginBottom: "0.35rem", fontWeight: 700 }}>
              🏷️ 洗滌分類
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#86efac" }}>
              {selectedBatch?.categoryName || "汙衣"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "1rem", color: "#94a3b8", marginBottom: "0.35rem", fontWeight: 700 }}>
              🖥️ 洗衣設備
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#fbbf24" }}>
              {displayEquipment}
            </div>
          </div>
        </div>

        {/* 待清洗批次卡片清單（取消下拉選單） */}
        <div style={{ margin: "1.25rem 0" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.75rem",
            }}
          >
            <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "#f8fafc", margin: 0 }}>
              {mode === "complete" ? "執行中單據" : "待清洗批次清單"}
            </h3>
            {sortedBatches.length > 0 && (
              <span style={{ fontSize: "0.95rem", color: "#94a3b8" }}>
                共 {sortedBatches.length} 筆批次
              </span>
            )}
          </div>

          {sortedBatches.length === 0 ? (
            <div
              style={{
                padding: "2rem",
                textAlign: "center",
                background: "rgba(255, 255, 255, 0.04)",
                borderRadius: "10px",
                border: "1px dashed rgba(255, 255, 255, 0.2)",
                color: "#94a3b8",
                fontSize: "1.1rem",
              }}
            >
              {mode === "complete"
                ? "目前沒有這台洗衣機的執行中單據"
                : equipmentInfo?.operatingSiteName
                  ? `【${equipmentInfo.operatingSiteName}】目前沒有待清洗批次`
                  : "目前沒有待清洗批次"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              {sortedBatches.map((batch) => {
                const isSelected = batch.id === batchId;
                return (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => setBatchId(batch.id)}
                    style={{
                      padding: "1.15rem 1.4rem",
                      textAlign: "left",
                      background: isSelected
                        ? "linear-gradient(135deg, rgba(13, 148, 136, 0.25), rgba(15, 118, 110, 0.35))"
                        : "rgba(255, 255, 255, 0.04)",
                      border: isSelected
                        ? "2px solid #2dd4bf"
                        : "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "10px",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.65rem",
                      transition: "all 0.15s ease-in-out",
                      boxShadow: isSelected ? "0 4px 14px rgba(45, 212, 191, 0.2)" : "none",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "0.5rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "1.25rem",
                          fontWeight: 800,
                          color: isSelected ? "#2dd4bf" : "#f8fafc",
                        }}
                      >
                        {batch.institutionName || "未指定機構"} · {batch.cartNumber || "未指定車號"}
                      </span>
                      <span
                        style={{
                          fontSize: "0.9rem",
                          padding: "0.3rem 0.85rem",
                          borderRadius: "9999px",
                          background: isSelected ? "#0d9488" : "rgba(255, 255, 255, 0.12)",
                          color: "#ffffff",
                          fontWeight: 800,
                          border: isSelected ? "1px solid #2dd4bf" : "1px solid transparent",
                        }}
                      >
                        {isSelected ? "✓ 目前選取" : "點擊選取"}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "1.02rem",
                        color: "#cbd5e1",
                        display: "flex",
                        gap: "1.25rem",
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <span>
                        單號：<strong style={{ color: "#ffffff" }}>{batch.orderNumber || "—"}</strong>
                      </span>
                      <span>
                        分類：<strong style={{ color: "#86efac" }}>{batch.categoryName || "汙衣"}</strong>
                      </span>
                      <span>
                        階段：<strong style={{ color: "#fde047" }}>第 {batch.current_stage_order} 階段</strong>
                      </span>
                      {batch.operating_site_name ? (
                        <span>
                          據點：<strong style={{ color: "#93c5fd" }}>{batch.operating_site_name}</strong>
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
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
            」，但當前洗衣機屬於「{equipmentInfo?.operatingSiteName || effectiveEquipmentObj?.operating_site_name}
            」！跨據點不可清洗。請選擇同據點批次或更換洗衣機。
          </p>
        ) : null}

        {mode === "complete" ? (
          <button
            type="button"
            onClick={() => void submit("/api/operations/complete-stage")}
            disabled={!batchId || (!activeToken && !effectiveEquipmentId) || submitting}
            style={{
              fontSize: "1.15rem",
              fontWeight: 800,
              padding: "0.85rem 1.75rem",
              borderRadius: "8px",
            }}
          >
            {submitting ? "處理中…" : "確認清洗完成"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submit("/api/operations/start-washing")}
            disabled={!batchId || (!activeToken && !effectiveEquipmentId) || submitting || isSiteMismatch}
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

      {scanResult?.kind === "started" || scanResult?.kind === "already-started" ? (
        <p className={styles.successNotice} role="status">
          {scanResult.status === "not_started" || scanResult.status === "completed"
            ? "清洗已結束"
            : "清洗已開始"}
          。
        </p>
      ) : scanResult && "reasonCode" in scanResult ? (
        <p className={styles.errorNotice} role="alert">
          {reasons[scanResult.reasonCode] ?? "清洗沒有開始。"}
        </p>
      ) : null}
    </div>
  );
}
