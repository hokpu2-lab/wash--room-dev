"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import styles from "../cart/scan.module.css";
import { readPendingQrToken, writePendingQrToken } from "../pending-qr-token";

type DispatchResult =
  | { kind: "dispatch"; href: string }
  | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

const TOKEN_PATTERN = /^v1\.equipment\.(wrq_v1\.[^.]+\.[^.]+)$/;

const reasons: Record<string, string> = {
  invalid_qr: "請再掃一次設備固定 QR。若從相機開啟，請確認網址含有設備代碼。",
  worker_scope_denied: "目前帳號不能操作這台設備。",
  authentication_required: "請先登入作業台再掃描設備。",
  service_unavailable: "系統暫時無法判斷控制點。",
};

function readEquipmentToken() {
  const hash = window.location.hash.slice(1);
  const fromHash = TOKEN_PATTERN.exec(hash);
  if (fromHash) return fromHash[1];

  const encoded = window.location.pathname.split("%23")[1] ?? "";
  const fromPath = TOKEN_PATTERN.exec(encoded);
  if (fromPath) return fromPath[1];

  return readPendingQrToken("equipment");
}

function persistToken(token: string) {
  writePendingQrToken("equipment", token);
}

export function EquipmentDispatchControl({ equipmentId }: { equipmentId?: string }) {
  const router = useRouter();
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let dispatched = false;
    const timers: number[] = [];

    function dispatch(qrToken: string) {
      if (dispatched) return;
      dispatched = true;
      if (qrToken) persistToken(qrToken);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      window.setTimeout(() => {
        if (!cancelled && qrToken) setToken(qrToken);
      }, 0);
      void fetch("/api/scan/equipment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(qrToken ? { qr_token: qrToken } : {}),
          ...(equipmentId ? { equipment_id: equipmentId } : {}),
        }),
      })
        .then(async (response) => {
          const body = (await response.json()) as DispatchResult;
          if (cancelled) return;
          if (body.kind === "dispatch") {
            if (qrToken) persistToken(qrToken);
            window.location.replace(
              qrToken ? `${body.href}#v1.equipment.${qrToken}` : body.href,
            );
            return;
          }
          setResult(needsLogin(body) ? { kind: "denied", reasonCode: "authentication_required" } : body);
        })
        .catch(() => {
          if (!cancelled) setResult({ kind: "denied", reasonCode: "authentication_required" });
        });
    }

    function consume(allowEmpty: boolean) {
      if (dispatched || cancelled) return;
      const qrToken = readEquipmentToken();
      if (qrToken || equipmentId) {
        dispatch(qrToken ?? "");
        return;
      }
      if (allowEmpty) return;
      window.setTimeout(() => {
        if (!cancelled && !dispatched) setResult({ kind: "invalid", reasonCode: "invalid_qr" });
      }, 0);
    }

    consume(true);
    for (const delay of [0, 80, 250, 800, 1600]) {
      timers.push(window.setTimeout(() => consume(delay < 1600), delay));
    }
    const onHashChange = () => consume(false);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [equipmentId]);

  function loginAsWorker() {
    if (token) persistToken(token);
    router.push("/login?next=/scan/equipment");
  }

  if (!result || result.kind === "dispatch") {
    return <p>正在確認設備並導向控制點…</p>;
  }

  if (result.reasonCode === "authentication_required") {
    return (
      <div className={styles.preview} aria-live="polite">
        <p className={styles.identity}>目前未登入</p>
        <p>設備控制點必須用洗衣員或洗衣主管帳號，在同一個瀏覽器登入後再掃。</p>
        <button type="button" className={styles.button} onClick={loginAsWorker}>
          前往登入後開始清洗
        </button>
      </div>
    );
  }

  return (
    <div className={styles.error} role="alert">
      <h2>目前無法進入控制點</h2>
      <p>{reasons[result.reasonCode] ?? "這次掃碼沒有完成。"}</p>
    </div>
  );
}

function needsLogin(result: DispatchResult) {
  if (result.kind === "dispatch") return false;
  return result.reasonCode !== "invalid_qr" && result.reasonCode !== "worker_scope_denied";
}
