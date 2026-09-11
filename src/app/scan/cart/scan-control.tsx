"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import styles from "./scan.module.css";

type ScanResult =
  | { kind: "created" | "already-created"; orderNumber: string; status: string }
  | { kind: "dispatch"; href: string; mode?: string; signedIn?: boolean }
  | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

const reasonLabels: Record<string, string> = {
  invalid_qr: "這張固定車卡 QR 無效或已撤銷。",
  inactive_cart: "這台洗衣車目前停用。",
  inactive_institution: "送洗機構目前停用。",
  inactive_site: "作業據點目前停用。",
  missing_pairing: "洗衣車尚未配對有效的送洗機構與作業據點。",
  existing_open_order: "這台洗衣車已有尚未結案的洗衣單。",
  rate_limited: "操作過於頻繁，請稍後再試。",
  request_replay: "這次操作無法重複使用。",
  service_unavailable: "系統暫時無法建立洗衣單，請稍後再試。",
};

const TOKEN_KEY = "wr_pending_cart_token";

function readTokenFromLocation() {
  const hash = window.location.hash.slice(1);
  const parts = hash.split(".");
  if (parts.length === 5 && parts[0] === "v1" && parts[1] === "cart" && parts[2] === "wrq_v1") {
    return parts.slice(2).join(".");
  }
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function ScanCartControl() {
  const router = useRouter();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(true);

  useEffect(() => {
    const qrToken = readTokenFromLocation();
    if (!qrToken) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      window.setTimeout(() => {
        setResult({ kind: "invalid", reasonCode: "invalid_qr" });
        setSubmitting(false);
      }, 0);
      return;
    }
    window.setTimeout(() => setToken(qrToken), 0);
    void fetch("/api/scan/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qr_token: qrToken, preview: true }),
    })
      .then(async (response) => {
        const body = (await response.json()) as ScanResult;
        setResult(body);
      })
      .catch(() => setResult({ kind: "failed", reasonCode: "service_unavailable" }))
      .finally(() => setSubmitting(false));
  }, []);

  async function confirmDropoff() {
    if (!token) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/scan/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qr_token: token, change_request_id: crypto.randomUUID() }),
      });
      const body = (await response.json()) as ScanResult;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      try {
        window.sessionStorage.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
      setResult(body);
    } catch {
      setResult({ kind: "failed", reasonCode: "service_unavailable" });
    } finally {
      setSubmitting(false);
    }
  }

  function continueToNextStep(href: string) {
    if (!token) return;
    if (href === "/scan/pickup") {
      try {
        window.sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* ignore */
      }
    }
    window.location.replace(`${href}#v1.cart.${token}`);
  }

  function loginAsWorker() {
    if (token) {
      try {
        window.sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* ignore */
      }
    }
    router.push("/login?next=/scan/cart");
  }

  if (submitting && !result) return <p>正在確認這張車卡與目前登入狀態…</p>;

  if (result?.kind === "dispatch" && result.mode === "anonymous_dropoff") {
    return (
      <div className={styles.preview} aria-live="polite">
        <p className={styles.identity}>{result.signedIn ? "目前已登入，但這台車還沒有待收件單" : "目前未登入"}</p>
        <p>這次掃碼將以<strong>送洗人員</strong>建立待收件洗衣單。</p>
        <button type="button" className={styles.button} onClick={() => void confirmDropoff()} disabled={submitting}>
          {submitting ? "送單中…" : "確認送單"}
        </button>
        {result.signedIn ? null : (
          <button type="button" className={styles.secondary} onClick={loginAsWorker}>
            我是洗衣員，先登入再收單
          </button>
        )}
      </div>
    );
  }

  if (result?.kind === "dispatch" && result.mode === "pickup") {
    return (
      <div className={styles.preview} aria-live="polite">
        <p className={styles.identity}>{result.signedIn ? "目前已登入" : "目前未登入"}</p>
        <p>這次掃碼將由<strong>送洗人員</strong>確認取件，不需要登入。</p>
        <button type="button" className={styles.button} onClick={() => continueToNextStep(result.href)}>
          確認取件
        </button>
      </div>
    );
  }

  if (result?.kind === "dispatch") {
    const action =
      result.mode === "receive" ? "收單與分類" : result.mode === "load" ? "裝回來源車" : "進入作業台";
    return (
      <div className={styles.preview} aria-live="polite">
        <p className={styles.identity}>目前已登入</p>
        <p>這次掃碼將以<strong>洗衣員</strong>進行{action}。</p>
        <button type="button" className={styles.button} onClick={() => continueToNextStep(result.href)}>
          前往{action}
        </button>
      </div>
    );
  }

  if (result?.kind === "created" || result?.kind === "already-created") {
    return (
      <div className={styles.success} role="status">
        <h2>{result.kind === "already-created" ? "送單已確認" : "送單建立完成"}</h2>
        <p>洗衣單 {result.orderNumber}，目前狀態：待收件。</p>
      </div>
    );
  }

  if (result && "reasonCode" in result) {
    return (
      <div className={styles.error} role="alert">
        <h2>目前無法完成掃碼</h2>
        <p>{reasonLabels[result.reasonCode] ?? "這次掃碼沒有完成。"}</p>
      </div>
    );
  }

  return <p>正在確認這張車卡與目前登入狀態…</p>;
}
