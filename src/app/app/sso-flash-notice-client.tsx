"use client";

import { useEffect, useState } from "react";

import styles from "./workspace-shell.module.css";

function isMessagePayload(value: unknown): value is { message: string | null } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    (typeof value.message === "string" || value.message === null)
  );
}

export function SsoFlashNoticeClient() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/sso-flash", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        return isMessagePayload(payload) ? payload.message : null;
      })
      .then((nextMessage) => {
        if (!cancelled && nextMessage) setMessage(nextMessage);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!message) return null;
  return (
    <p className={styles.ssoFlashNotice} role="status" aria-live="polite">
      {message}
    </p>
  );
}
