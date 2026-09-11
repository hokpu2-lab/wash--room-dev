"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";

import type { WorkspaceSnapshot } from "@/lib/analytics/workspace-snapshot";

import { ModuleTabs } from "../../module-tabs";
import { batchStatusLabels } from "../../status-labels";
import { useWorkspaceLive } from "../../use-workspace-live";
import styles from "../../workspace.module.css";
import { incidentAction, mergeAction, pauseAction, replanAction, resumeAction, reverseLastOperationAction } from "./actions";

const controlResultLabels: Record<string, string> = {
  stage_start_reversed: "已取消誤開始的階段並釋放設備。",
  stage_completion_reopened: "已保留完成紀錄，並重新開啟原階段。",
  source_load_reversed: "已恢復待裝車，並撤銷待取件狀態。",
  nothing_to_reverse: "目前沒有可安全還原的上一步。",
  order_already_picked_up: "洗衣單已取件，不能自動還原。請改用更正流程。",
  worker_scope_denied: "你沒有這個作業據點的還原權限。",
  equipment_state_conflict: "設備目前有其他作業，為避免衝突未執行還原。",
  invalid_reason: "請填寫 2 至 500 字的還原原因。",
  invalid: "欄位不完整，請確認批次、原因與確認勾選。",
  failed: "還原失敗，資料未變更，請稍後再試或聯絡主管。",
};

export function ControlCenterLive({
  initial,
  site,
  status,
}: {
  initial: WorkspaceSnapshot | null;
  site: string;
  status: string;
}) {
  const { snapshot, liveMode, syncedAt } = useWorkspaceLive(initial, { siteId: site || undefined, pageSize: 20 });
  const batches = snapshot?.batches ?? [];
  const reversalRequestId = useRef("");

  return (
    <>
      {status ? <p className={status.endsWith("reversed") || status.endsWith("reopened") ? styles.successNotice : styles.warningNotice} role="status">{controlResultLabels[status] ?? `控制點結果：${status}`}</p> : null}
      <p className={styles.hint}>
        {liveMode === "realtime" ? "即時更新" : liveMode === "poll" ? "定時更新" : "伺服器快照"}
        {syncedAt ? ` · 最後同步 ${new Date(syncedAt).toLocaleTimeString("zh-Hant")}` : ""}
      </p>
      <ModuleTabs
        ariaLabel="批次控制功能"
        storageKey="control-center"
        tabs={[
          { id: "batches", label: "目前批次", description: "即時狀態與可操作批次", count: batches.length },
          { id: "reverse", label: "還原上一步", description: "補償最後一個錯誤控制點" },
          { id: "workflow", label: "批次操作", description: "合併、暫停與恢復" },
          { id: "exceptions", label: "異常與重排", description: "重工、故障與排程建議" },
        ]}
      >
      <section aria-labelledby="batch-list-title">
        <p className={styles.eyebrow}>OPEN BATCHES</p>
        <h2 id="batch-list-title">目前批次</h2>
        {batches.length === 0 ? (
          <p>目前沒有未完成批次。</p>
        ) : (
          <div className={styles.batchList}>
            {batches.map((batch) => (
              <article key={batch.id} className={styles.batchCard}>
                <div>
                  <strong>{batch.orderNumber}</strong>
                  <small>{batch.categoryName} · 第 {batch.stageOrder} 階段 · {batch.id.slice(0, 8)}</small>
                </div>
                <span className={`${styles.badge} ${styles.badgeTeal}`}>{batchStatusLabels[batch.status]}</span>
              </article>
            ))}
          </div>
        )}
      </section>
      <form
          action={reverseLastOperationAction}
          className={`${styles.accessForm} ${styles.reversalForm}`}
          onSubmit={(event) => {
            const requestInput = event.currentTarget.elements.namedItem("request");
            if (requestInput instanceof HTMLInputElement && !requestInput.value) {
              reversalRequestId.current ||= crypto.randomUUID();
              requestInput.value = reversalRequestId.current;
            }
          }}
        >
          <div>
            <p className={styles.eyebrow}>SAFE REVERSAL</p>
            <h2>還原上一步</h2>
          </div>
          <p>僅自動處理誤開始、誤完成或誤裝車；不會刪除原操作紀錄。已取件或已有後續作業時會拒絕。</p>
          <input type="hidden" name="request" defaultValue="" />
          <BatchSelect name="batch" batches={batches} label="要還原的批次" />
          <label>還原原因
            <textarea className={styles.reasonField} name="reason" required minLength={2} maxLength={500} placeholder="例如：誤掃到 2 號洗衣機，實際尚未放入設備" />
          </label>
          <label className={styles.checkboxLabel}>
            <input type="checkbox" name="confirmed" value="yes" required />
            我已確認這是最後一個錯誤操作
          </label>
          <ReverseSubmitButton disabled={batches.length === 0} />
      </form>
      <div className={styles.formGrid}>
        <form action={mergeAction} className={styles.accessForm}>
          <h2>合併相容批次</h2>
          <BatchSelect name="target" batches={batches} label="目標批次" />
          <BatchSelect name="source" batches={batches} label="來源批次" />
          <button type="submit">合併（保留來源）</button>
        </form>
        <form action={pauseAction} className={styles.accessForm}>
          <h2>暫停階段</h2>
          <BatchSelect name="batch" batches={batches} label="批次" />
          <label>原因<input name="reason" required /></label>
          <button type="submit">暫停</button>
        </form>
        <form action={resumeAction} className={styles.accessForm}>
          <h2>恢復階段</h2>
          <BatchSelect name="batch" batches={batches} label="批次" />
          <button type="submit">恢復</button>
        </form>
      </div>
      <div className={styles.formGrid}>
        <form action={incidentAction} className={styles.accessForm}>
          <h2>記錄異常／重工</h2>
          <BatchSelect name="batch" batches={batches} label="批次" />
          <label>異常類型
            <select name="type" defaultValue="damaged">
              <option value="damaged">破損</option>
              <option value="missing">短少</option>
              <option value="equipment_failed">設備故障</option>
              <option value="rewash">重洗</option>
              <option value="redry">重烘</option>
            </select>
          </label>
          <label>責任
            <select name="responsibility" defaultValue="洗衣房">
              <option value="洗衣房">洗衣房</option>
              <option value="送洗機構">送洗機構</option>
              <option value="設備">設備</option>
              <option value="未知">未知</option>
            </select>
          </label>
          <label>說明<input name="description" required /></label>
          <button type="submit">記錄</button>
        </form>
        {site ? (
          <form action={replanAction} className={styles.accessForm}>
            <h2>產生重排建議</h2>
            <input type="hidden" name="site" value={site} />
            <label>原因<input name="reason" required /></label>
            <button type="submit">只提出建議</button>
          </form>
        ) : null}
      </div>
      </ModuleTabs>
    </>
  );
}

function ReverseSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending}>
      {pending ? "正在安全還原…" : "確認還原上一步"}
    </button>
  );
}

function BatchSelect({
  name,
  label,
  batches,
}: {
  name: string;
  label: string;
  batches: Array<{ id: string; orderNumber: string; categoryName: string }>;
}) {
  return (
    <label>
      {label}
      <select name={name} required disabled={batches.length === 0} defaultValue={batches[0]?.id ?? ""}>
        {batches.length === 0 ? <option value="">目前沒有可選批次</option> : null}
        {batches.map((batch) => (
          <option key={`${name}-${batch.id}`} value={batch.id}>
            {batch.orderNumber} · {batch.categoryName}
          </option>
        ))}
      </select>
    </label>
  );
}
