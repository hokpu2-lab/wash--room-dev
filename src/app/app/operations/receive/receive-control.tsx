"use client";

import { useState } from "react";

import { ScanStage } from "../../scan-stage";
import { useQrFragment } from "../../use-qr-fragment";
import styles from "../../workspace.module.css";

type Category = { code: string; name: string };
type Result = { kind: "received" | "already-received"; batchCount: number; status: string } | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

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
  const scanResult = result ?? (missing ? { kind: "invalid" as const, reasonCode: "invalid_qr" } : null);

  async function submit() {
    if (!token || selected.length === 0) { setResult({ kind: "invalid", reasonCode: "invalid_categories" }); return; }
    setSubmitting(true); setResult(null);
    try {
      const response = await fetch("/api/operations/receive-cart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qr_token: token, category_codes: selected, change_request_id: crypto.randomUUID() }) });
      setResult((await response.json()) as Result);
    } catch { setResult({ kind: "failed", reasonCode: "service_unavailable" }); } finally { setSubmitting(false); }
  }

  return (
    <div aria-live="polite">
      <ScanStage
        scanned={Boolean(token)}
        waitingText="請掃描固定洗衣車 QR。"
        readyText="已掃描車卡，請選擇本車內容的洗滌分類。"
      >
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
              {category.name}（{category.code}）
            </label>
          ))}
        </fieldset>
        <button type="button" onClick={submit} disabled={!token || submitting}>
          {submitting ? "收單中…" : "確認收單並建立批次"}
        </button>
      </ScanStage>
      {scanResult?.kind === "received" || scanResult?.kind === "already-received" ? (
        <p className={styles.successNotice} role="status">
          {scanResult.kind === "already-received" ? "收單已確認" : "收單完成"}，已建立 {scanResult.batchCount} 個初始批次，狀態為待清洗。
        </p>
      ) : scanResult && "reasonCode" in scanResult ? (
        <p className={styles.errorNotice} role="alert">{reasons[scanResult.reasonCode] ?? "收單沒有完成。"}</p>
      ) : null}
    </div>
  );
}
