"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { markWorkspaceNavigating } from "./navigation-progress";
import styles from "./workspace-shell.module.css";

type InboxItem = {
  id: string;
  event_key: string;
  severity: string;
  content_summary: string;
  status: string;
  created_at: string;
  href?: string;
  action_label?: string;
};

const eventLabels: Record<string, string> = {
  order_ready_for_pickup: "洗衣單待取件",
  order_overdue: "洗衣單逾期",
  batch_incident_critical: "批次嚴重異常",
  progress_digest: "進度摘要",
};

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [detail, setDetail] = useState<InboxItem | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/app/notifications", { cache: "no-store" });
    if (!response.ok) {
      setItems([]);
      return;
    }
    const payload = await response.json() as { items?: InboxItem[] };
    setItems(payload.items ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function goTo(item: InboxItem) {
    setOpen(false);
    if (!item.href) {
      setDetail(item);
      return;
    }
    markWorkspaceNavigating();
    setDetail(null);
    router.push(item.href);
  }

  return (
    <div className={styles.notificationBell}>
      <button
        type="button"
        className={styles.notificationBellButton}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((current) => !current);
          void load();
        }}
      >
        通知
        {items.length ? <b>{items.length > 9 ? "9+" : items.length}</b> : null}
      </button>
      {open ? (
        <div className={styles.notificationPanel} role="dialog" aria-label="通知訊息">
          {items.length === 0 ? <p>目前沒有站內通知。</p> : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => goTo(item)}>
                    <strong>{eventLabels[item.event_key] ?? item.event_key}</strong>
                    <small>{item.content_summary}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {detail ? (
        <div
          className={styles.notificationDetailBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetail(null);
          }}
        >
          <section className={styles.notificationDetail} role="dialog" aria-label="通知訊息資訊">
            <header>
              <h2>{eventLabels[detail.event_key] ?? detail.event_key}</h2>
              <button type="button" onClick={() => setDetail(null)} aria-label="關閉">×</button>
            </header>
            <p>{detail.content_summary}</p>
            {detail.href ? (
              <button
                className={styles.notificationAction}
                type="button"
                onClick={() => goTo(detail)}
              >
                {detail.action_label ?? "查看洗衣單"}
              </button>
            ) : null}
            <small>
              {new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" }).format(new Date(detail.created_at))}
              {" · "}
              {detail.status === "sent" ? "已送達" : detail.status}
            </small>
          </section>
        </div>
      ) : null}
    </div>
  );
}
