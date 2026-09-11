"use client";

import {
  mergeWorkspaceSnapshots,
  parseWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "@/lib/analytics/workspace-snapshot";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

import { getAuthorizedSiteIds } from "./workspace-scope-client";

const POLL_MS = 15_000;
const MIN_REFRESH_MS = 1_000;
const LAST_SYNC_KEY = "wash-room-last-sync";
const CHANNEL_NAME = "workspace-read-model";

export type LiveMode = "off" | "poll" | "realtime";
export type LiveInput = { siteId?: string | null; query?: string | null; page?: number; pageSize?: number };
export type LiveState = {
  snapshot: WorkspaceSnapshot | null;
  syncedAt: string | null;
  liveMode: LiveMode;
};

type Listener = (state: LiveState) => void;

let client: ReturnType<typeof createBrowserSupabaseClient> | null | undefined;
let channel: { unsubscribe: () => Promise<unknown> } | null = null;
let pollTimer: number | null = null;
let throttleTimer: number | null = null;
let lastRefreshAt = 0;
let started = false;
let input: LiveInput = {};
let state: LiveState = { snapshot: null, syncedAt: null, liveMode: "off" };
const listeners = new Set<Listener>();

function getClient() {
  if (client === undefined) client = createBrowserSupabaseClient();
  return client;
}

function emit() {
  listeners.forEach((listener) => listener(state));
}

function persistSync(generatedAt: string) {
  try {
    window.sessionStorage.setItem(LAST_SYNC_KEY, generatedAt);
  } catch {
    /* ignore */
  }
}

export function readStoredSync() {
  try {
    return window.sessionStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

async function refresh() {
  const supabase = getClient();
  if (!supabase) return;
  lastRefreshAt = Date.now();
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 40);
  const page = Math.max(input.page ?? 1, 1);
  const query = input.query?.trim() || null;
  const siteIds = input.siteId ? [input.siteId] : getAuthorizedSiteIds();
  if (!input.siteId && siteIds.length === 0) return;
  const targets = siteIds.length > 0 ? siteIds : [null];
  const parts: WorkspaceSnapshot[] = [];
  for (const siteId of targets) {
    const rpcInput = {
      target_site_id: siteId,
      order_limit: pageSize,
      order_offset: (page - 1) * pageSize,
      order_query: query,
    };
    let { data, error } = await supabase.rpc("get_workspace_snapshot_with_details", rpcInput);
    if (error) {
      ({ data, error } = await supabase.rpc("get_workspace_snapshot", rpcInput));
    }
    if (error) continue;
    const parsed = parseWorkspaceSnapshot(data, { query: query ?? undefined, page, pageSize });
    if (parsed) parts.push(parsed);
  }
  const parsed = mergeWorkspaceSnapshots(parts, { query: query ?? undefined, page, pageSize });
  if (!parsed) return;
  state = { ...state, snapshot: parsed, syncedAt: parsed.generatedAt };
  persistSync(parsed.generatedAt);
  emit();
}

function requestRefresh() {
  const elapsed = Date.now() - lastRefreshAt;
  if (elapsed >= MIN_REFRESH_MS) {
    void refresh();
    return;
  }
  if (throttleTimer !== null) return;
  throttleTimer = window.setTimeout(() => {
    throttleTimer = null;
    void refresh();
  }, MIN_REFRESH_MS - elapsed);
}

function setMode(liveMode: LiveMode) {
  if (state.liveMode === liveMode) return;
  state = { ...state, liveMode };
  emit();
}

function subscribeChannel() {
  const supabase = getClient();
  if (!supabase) return;
  if (channel) {
    void supabase.removeChannel(channel as never);
    channel = null;
  }
  try {
    const next = supabase
      .channel(CHANNEL_NAME)
      .on("postgres_changes", { event: "*", schema: "public", table: "laundry_orders" }, requestRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "laundry_batches" }, requestRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "laundry_equipment" }, requestRefresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setMode("realtime");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setMode("poll");
        }
      });
    channel = next;
  } catch {
    setMode("poll");
  }
}

function start() {
  if (started) return;
  const supabase = getClient();
  if (!supabase) return;
  started = true;
  setMode("poll");
  void refresh();
  pollTimer = window.setInterval(() => void refresh(), POLL_MS);
  subscribeChannel();
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
}

function stop() {
  const supabase = getClient();
  started = false;
  if (pollTimer !== null) window.clearInterval(pollTimer);
  if (throttleTimer !== null) window.clearTimeout(throttleTimer);
  pollTimer = null;
  throttleTimer = null;
  window.removeEventListener("online", onOnline);
  document.removeEventListener("visibilitychange", onVisible);
  if (channel && supabase) void supabase.removeChannel(channel as never);
  channel = null;
  state = { ...state, liveMode: "off" };
}

function onOnline() {
  setMode("poll");
  subscribeChannel();
  requestRefresh();
}

function onVisible() {
  if (document.visibilityState !== "visible") return;
  if (state.liveMode !== "realtime") subscribeChannel();
  requestRefresh();
}

export function subscribeWorkspaceLive(nextInput: LiveInput, listener: Listener) {
  input = nextInput;
  listeners.add(listener);
  listener(state);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}
