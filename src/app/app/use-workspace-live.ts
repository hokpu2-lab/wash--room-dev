"use client";

import { useEffect, useState } from "react";

import type { WorkspaceSnapshot } from "@/lib/analytics/workspace-snapshot";

import {
  readStoredSync,
  subscribeWorkspaceLive,
  type LiveMode,
} from "./workspace-live-session";
import { rememberClientWorkspaceScope } from "./workspace-scope-client";

export function useWorkspaceLive(
  initial: WorkspaceSnapshot | null,
  input: { siteId?: string; query?: string; page?: number; pageSize?: number },
) {
  const [snapshot, setSnapshot] = useState(initial);
  const [syncedAt, setSyncedAt] = useState(initial?.generatedAt ?? null);
  const [liveMode, setLiveMode] = useState<LiveMode>("off");
  const siteId = input.siteId ?? null;
  const query = input.query?.trim() || null;
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 40);

  useEffect(() => {
    if (input.siteId) rememberClientWorkspaceScope({ siteId: input.siteId, institutionId: null });
    const storedTimer = window.setTimeout(() => {
      const stored = readStoredSync();
      if (stored) setSyncedAt((current) => current ?? stored);
    }, 0);
    const unsubscribe = subscribeWorkspaceLive({ siteId, query, page, pageSize }, (next) => {
      if (next.snapshot) setSnapshot(next.snapshot);
      if (next.syncedAt) setSyncedAt(next.syncedAt);
      setLiveMode(next.liveMode);
    });
    return () => {
      window.clearTimeout(storedTimer);
      unsubscribe();
    };
  }, [siteId, query, page, pageSize]);

  return { snapshot, syncedAt, liveMode };
}
