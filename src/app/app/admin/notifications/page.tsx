import { requireRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { AppLink } from "../../app-link";
import { ModuleTabs } from "../../module-tabs";
import styles from "../../workspace.module.css";
import { saveDestination, saveNotificationRule, testEmailDestination, toggleNotificationRule } from "./actions";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const destinationTypeLabels = { email: "Email", line: "LINE", telegram: "Telegram" } as const;
const eventLabels = {
  order_ready_for_pickup: "洗衣單待取件",
  order_overdue: "洗衣單逾期",
  batch_incident_critical: "批次嚴重異常",
  progress_digest: "進度摘要",
} as const;
const channelLabels = { in_app: "站內", email: "Email", line: "LINE", telegram: "Telegram" } as const;
const roleLabels = {
  laundry_supervisor: "洗衣主管",
  institution_supervisor: "送洗機構主管",
} as const;
const severityLabels = { normal: "一般", high: "高", critical: "嚴重" } as const;

export default async function NotificationsPage({ searchParams }: Props) {
  await requireRole("laundry_supervisor");
  const query = await searchParams;
  const status = typeof query.status === "string" ? query.status : "";
  const editId = typeof query.edit === "string" ? query.edit : "";
  const supabase = await createServerSupabaseClient();
  const { data: destinations } = await supabase
    .from("notification_external_destinations")
    .select("id, destination_type, label, destination, active")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(40);
  const { data: rules } = await supabase
    .from("notification_matrix_rules")
    .select("id, event_key, channel, recipient_role, severity, enabled")
    .order("event_key", { ascending: true })
    .limit(80);
  const editing = rules?.find((rule) => rule.id === editId);
  const { data: inbox } = await supabase
    .from("notification_outbox")
    .select("id, event_key, channel, severity, content_summary, status, created_at")
    .eq("channel", "in_app")
    .order("created_at", { ascending: false })
    .limit(30);
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="notification-title">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>NOTIFICATION MATRIX</p>
            <h1 id="notification-title">通知矩陣與外部目的地</h1>
            <p className={styles.lede}>站內通知會寫入下方收件匣，登入後可在本頁查看。Email 寄到帳號通知 Email 與外部目的地；金鑰只放環境變數。</p>
          </div>
        </header>
        {status ? (
          <p className={status.includes("saved") ? styles.successNotice : styles.errorNotice} role="status">
            {status === "email-unconfigured"
              ? "已保存目的地，但尚未設定 GMAIL_USER 與 GMAIL_APP_PASSWORD，測試信未寄出。"
              : status.includes("saved")
                ? "通知設定已保存。"
                : "通知設定無效或保存失敗。"}
          </p>
        ) : null}
        <ModuleTabs
          ariaLabel="通知設定功能"
          storageKey="notifications"
          tabs={[
            { id: "rules", label: "通知規則", description: "事件、角色、通道與嚴重度" },
            { id: "destinations", label: "外部目的地", description: "Email、LINE 與 Telegram 收件位置" },
          ]}
        >
          <div className={styles.managementSection}>
            <form key={editing?.id ?? "create"} action={saveNotificationRule} className={styles.accessForm}>
              {editing ? <input type="hidden" name="rule_id" value={editing.id} /> : null}
              <h2>{editing ? "編輯通知規則" : "設定通知規則"}</h2>
              <p className={styles.lede}>點列表的「編輯」可改通道、角色、嚴重度與啟用。同一事件＋通道＋角色會覆蓋原規則。</p>
              <label>事件
                <select name="event" defaultValue={editing?.event_key ?? "order_ready_for_pickup"} required>
                  {Object.entries(eventLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>通道
                <select name="channel" defaultValue={editing?.channel ?? "in_app"}>
                  {Object.entries(channelLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>收件角色
                <select name="role" defaultValue={editing?.recipient_role ?? "laundry_supervisor"}>
                  {Object.entries(roleLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>嚴重度
                <select name="severity" defaultValue={editing?.severity ?? "normal"}>
                  {Object.entries(severityLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <input name="enabled" type="checkbox" defaultChecked={editing?.enabled ?? true} />
                啟用此規則
              </label>
              <button type="submit">{editing ? "更新規則" : "保存規則"}</button>
              {editing ? <AppLink href="/app/admin/notifications#tab=rules">取消編輯</AppLink> : null}
            </form>
            {rules?.length ? (
              <div className={styles.tableScroller}>
                <table>
                  <thead>
                    <tr>
                      <th>事件</th>
                      <th>通道</th>
                      <th>收件角色</th>
                      <th>嚴重度</th>
                      <th>狀態</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{eventLabels[rule.event_key as keyof typeof eventLabels] ?? rule.event_key}</td>
                        <td>{channelLabels[rule.channel as keyof typeof channelLabels] ?? rule.channel}</td>
                        <td>{roleLabels[rule.recipient_role as keyof typeof roleLabels] ?? rule.recipient_role}</td>
                        <td>{severityLabels[rule.severity as keyof typeof severityLabels] ?? rule.severity}</td>
                        <td>{rule.enabled ? "啟用" : "停用"}</td>
                        <td>
                          <AppLink href={`/app/admin/notifications?edit=${encodeURIComponent(rule.id)}#tab=rules`}>編輯</AppLink>
                          {" "}
                          <form action={toggleNotificationRule}>
                            <input type="hidden" name="rule_id" value={rule.id} />
                            <input type="hidden" name="enabled" value={rule.enabled ? "false" : "true"} />
                            <button type="submit">{rule.enabled ? "停用" : "啟用"}</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p>尚未設定通知規則。</p>}
            <section className={styles.managementSection} aria-labelledby="in-app-inbox-title">
              <h2 id="in-app-inbox-title">站內通知收件匣</h2>
              <p className={styles.lede}>通道選「站內」時，符合角色的登入者會在此看到通知，不會寄信。待取件、逾期、嚴重異常發生時自動寫入。</p>
              {inbox?.length ? (
                <div className={styles.tableScroller}>
                  <table>
                    <thead>
                      <tr>
                        <th>時間</th>
                        <th>事件</th>
                        <th>嚴重度</th>
                        <th>內容</th>
                        <th>狀態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inbox.map((item) => (
                        <tr key={item.id}>
                          <td>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.created_at))}</td>
                          <td>{eventLabels[item.event_key as keyof typeof eventLabels] ?? item.event_key}</td>
                          <td>{severityLabels[item.severity as keyof typeof severityLabels] ?? item.severity}</td>
                          <td>{item.content_summary}</td>
                          <td>{item.status === "sent" ? "已送達" : item.status === "failed" ? "失敗" : "待處理"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p>目前沒有站內通知。</p>}
            </section>
          </div>
          <div className={styles.managementSection}>
            <form action={saveDestination} className={styles.accessForm}>
              <h2>Email／LINE／Telegram 目的地</h2>
              <label>類型<select name="type" defaultValue="email"><option value="email">Email</option><option value="line">LINE</option><option value="telegram">Telegram</option></select></label>
              <label>顯示名稱<input name="label" required /></label>
              <label>目的地（Email 請填信箱）<input name="destination" required /></label>
              <button type="submit">保存目的地</button>
            </form>
            {destinations?.length ? (
              <div className={styles.tableScroller}>
                <table>
                  <thead>
                    <tr>
                      <th>類型</th>
                      <th>名稱</th>
                      <th>目的地</th>
                      <th>測試</th>
                    </tr>
                  </thead>
                  <tbody>
                    {destinations.map((destination) => (
                      <tr key={destination.id}>
                        <td>{destinationTypeLabels[destination.destination_type as keyof typeof destinationTypeLabels] ?? destination.destination_type}</td>
                        <td>{destination.label}</td>
                        <td>{destination.destination}</td>
                        <td>
                          {destination.destination_type === "email" ? (
                            <form action={testEmailDestination}>
                              <input type="hidden" name="destination_id" value={destination.id} />
                              <button type="submit">寄送測試信</button>
                            </form>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p>尚未登錄外部目的地。</p>}
          </div>
        </ModuleTabs>
      </section>
    </main>
  );
}
