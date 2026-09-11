"use client";

import { useEffect, useRef, useState } from "react";

import { readPendingQrToken, writePendingQrToken } from "../scan/pending-qr-token";

const patterns = {
  cart: /^v1\.cart\.(wrq_v1\.[^.]+\.[^.]+)$/,
  equipment: /^v1\.equipment\.(wrq_v1\.[^.]+\.[^.]+)$/,
} as const;

export function useQrFragment(kind: keyof typeof patterns) {
  const [token, setToken] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const pattern = patterns[kind];

    function keep(next: string) {
      tokenRef.current = next;
      writePendingQrToken(kind, next);
      setToken(next);
      setMissing(false);
    }

    function consume(allowEmpty: boolean) {
      const hash = window.location.hash.slice(1);
      const match = pattern.exec(hash);
      if (match) {
        keep(match[1]);
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        return;
      }
      const stored = readPendingQrToken(kind);
      if (stored) {
        keep(stored);
        return;
      }
      if (allowEmpty || tokenRef.current) return;
      setToken(null);
      setMissing(true);
    }

    consume(true);
    const retries = [0, 80, 250, 800].map((delay) =>
      window.setTimeout(() => consume(delay < 800), delay),
    );
    const onHashChange = () => consume(false);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      retries.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [kind]);

  return { token, missing };
}
