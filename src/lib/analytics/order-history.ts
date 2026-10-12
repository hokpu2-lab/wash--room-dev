import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  parseLaundryOrderHistory,
  parseLaundryOrderHistoryDetail,
  type LaundryOrderHistory,
  type LaundryOrderHistoryDetail,
  type LaundryOrderHistoryInput,
  type LaundryOrderHistoryItem,
} from "./order-history-model";
import { getWorkspaceOrderDetail, getWorkspaceSnapshot } from "./workspace";

export type {
  LaundryOrderHistory,
  LaundryOrderHistoryDetail,
  LaundryOrderHistoryInput,
} from "./order-history-model";

function deriveStageName(
  status: string,
  batches?: { stages?: { name?: string; equipmentType?: string; state?: string; stageOrder?: number }[]; currentStageOrder?: number; status?: string; activeStageRunId?: string | null }[]
): string {
  if (status === "picked_up") return "取件完成";
  if (status === "ready_for_pickup") return "待取件";
  if (status === "awaiting_receipt") return "待收件";
  if (status === "awaiting_cleaning") return "待清洗";
  if (status === "in_process" && batches && batches.length > 0) {
    const firstBatch = batches[0];
    const currentStage = firstBatch.stages?.find(
      (s) => s.stageOrder === firstBatch.currentStageOrder || s.state === "active"
    ) ?? firstBatch.stages?.[0];
    const eqType = currentStage?.equipmentType;
    if (eqType === "washer") {
      return firstBatch.status === "in_progress" ? "清洗中" : "待洗衣";
    }
    if (eqType === "dryer") {
      return firstBatch.status === "in_progress" ? "烘乾中" : "待烘衣";
    }
    if (eqType === "disinfection_tank") {
      return firstBatch.status === "in_progress" ? "消毒中" : "待消毒";
    }
    return currentStage?.name || "處理中";
  }
  return status === "in_process" ? "處理中" : status;
}

async function enrichMissingTimings(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  items: LaundryOrderHistoryItem[],
): Promise<void> {
  const missingReceived = items.filter((item) => !item.receivedAt && item.status !== "awaiting_receipt");
  const missingReady = items.filter(
    (item) => !item.readyAt && (item.status === "ready_for_pickup" || item.status === "picked_up"),
  );
  if (missingReceived.length === 0 && missingReady.length === 0) return;

  const targetIds = Array.from(new Set([...missingReceived.map((i) => i.id), ...missingReady.map((i) => i.id)]));
  try {
    const { data: batches } = await supabase
      .from("laundry_batches")
      .select("laundry_order_id, created_at, loaded_at, completed_at, status")
      .in("laundry_order_id", targetIds);

    if (batches && batches.length > 0) {
      const batchReceivedMap = new Map<string, string>();
      const batchReadyMap = new Map<string, string>();
      for (const batch of batches) {
        const prevReceived = batchReceivedMap.get(batch.laundry_order_id);
        if (!prevReceived || new Date(batch.created_at).getTime() < new Date(prevReceived).getTime()) {
          batchReceivedMap.set(batch.laundry_order_id, batch.created_at);
        }
        const readyCandidate = batch.loaded_at || batch.completed_at;
        if (readyCandidate) {
          const prevReady = batchReadyMap.get(batch.laundry_order_id);
          if (!prevReady || new Date(readyCandidate).getTime() > new Date(prevReady).getTime()) {
            batchReadyMap.set(batch.laundry_order_id, readyCandidate);
          }
        }
      }
      for (const item of items) {
        if (!item.receivedAt && batchReceivedMap.has(item.id)) {
          item.receivedAt = batchReceivedMap.get(item.id)!;
        }
        if (!item.readyAt && (item.status === "ready_for_pickup" || item.status === "picked_up")) {
          if (batchReadyMap.has(item.id)) {
            item.readyAt = batchReadyMap.get(item.id)!;
          }
        }
      }
    }
  } catch {
    // ignore batch query errors
  }

  // Second pass fallback for any remaining items
  const stillMissingReceived = items.filter((item) => !item.receivedAt && item.status !== "awaiting_receipt");
  const stillMissingReady = items.filter((item) => !item.readyAt && (item.status === "ready_for_pickup" || item.status === "picked_up"));
  if (stillMissingReceived.length > 0 || stillMissingReady.length > 0) {
    try {
      const auditTargetIds = Array.from(new Set([...stillMissingReceived.map((i) => i.id), ...stillMissingReady.map((i) => i.id)]));
      const { data: audits } = await supabase
        .from("authorization_audit_events")
        .select("laundry_order_id, occurred_at, action")
        .in("action", [
          "laundry_order_received",
          "laundry_batch_loaded_to_source_cart",
          "laundry_batch_completed_without_source_loading",
          "laundry_batch_drying_completed",
        ])
        .eq("outcome", "succeeded")
        .in("laundry_order_id", auditTargetIds);

      if (audits && audits.length > 0) {
        const receivedMap = new Map<string, string>();
        const readyMap = new Map<string, string>();
        for (const audit of audits) {
          if (!audit.laundry_order_id) continue;
          if (audit.action === "laundry_order_received") {
            const prev = receivedMap.get(audit.laundry_order_id);
            if (!prev || new Date(audit.occurred_at).getTime() < new Date(prev).getTime()) {
              receivedMap.set(audit.laundry_order_id, audit.occurred_at);
            }
          } else {
            const prev = readyMap.get(audit.laundry_order_id);
            if (!prev || new Date(audit.occurred_at).getTime() > new Date(prev).getTime()) {
              readyMap.set(audit.laundry_order_id, audit.occurred_at);
            }
          }
        }
        for (const item of items) {
          if (!item.receivedAt && receivedMap.has(item.id)) {
            item.receivedAt = receivedMap.get(item.id)!;
          }
          if (!item.readyAt && readyMap.has(item.id)) {
            item.readyAt = readyMap.get(item.id)!;
          }
        }
      }
    } catch {
      // ignore audit query errors
    }
  }
}

export async function getLaundryOrderHistory(input: LaundryOrderHistoryInput): Promise<LaundryOrderHistory | null> {
  const supabase = await createServerSupabaseClient();
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 40);
  const page = Math.max(input.page ?? 1, 1);

  const [historyResult, snapshot] = await Promise.all([
    supabase.rpc("search_laundry_order_history", {
      target_site_id: input.siteId ?? null,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      order_query: input.query?.trim() || null,
      target_institution_id: input.institutionId ?? null,
      order_limit: pageSize,
      order_offset: (page - 1) * pageSize,
    }),
    getWorkspaceSnapshot({
      siteId: input.siteId,
      query: input.query,
      page: 1,
      pageSize: 40,
    }).catch(() => null),
  ]);

  let parsed = !historyResult.error
    ? parseLaundryOrderHistory(historyResult.data, { query: input.query, page, pageSize })
    : null;

  // If we have active orders from workspace snapshot, check if any need to be merged into the history list
  if (snapshot?.orders && snapshot.orders.length > 0) {
    const existingIds = new Set((parsed?.items ?? []).map((i) => i.id));
    const periodStartTime = new Date(input.periodStart).getTime();
    const periodEndTime = new Date(input.periodEnd).getTime();

    const activeItems: LaundryOrderHistoryItem[] = [];
    for (const order of snapshot.orders) {
      if (existingIds.has(order.id)) continue;
      const orderDetail = snapshot.orderDetails?.find((d) => d.orderId === order.id);
      const orderTimeIso = orderDetail?.orderCreatedAt ?? order.updatedAt ?? new Date().toISOString();
      const orderTime = new Date(orderTimeIso).getTime();
      if (!isNaN(periodStartTime) && !isNaN(periodEndTime)) {
        if (orderTime < periodStartTime || orderTime >= periodEndTime) {
          continue;
        }
      }

      const stageName = deriveStageName(order.status, orderDetail?.batches);
      const receivedAtIso = orderDetail?.orderReceivedAt
        ?? (order.status !== "awaiting_receipt" ? (orderDetail?.orderCreatedAt ?? order.updatedAt) : null);
      const readyAtIso = orderDetail?.orderReadyAt
        ?? (order.status === "ready_for_pickup" || order.status === "picked_up" ? order.updatedAt : null);

      activeItems.push({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        stageName,
        createdAt: orderTimeIso,
        receivedAt: receivedAtIso ?? null,
        readyAt: readyAtIso ?? null,
        closedAt: null,
        institutionCode: "",
        institutionName: order.institutionName,
        cartNumber: order.cartNumber,
        siteCode: "MAIN",
        siteName: "本館",
      });
    }

    if (activeItems.length > 0) {
      if (!parsed) {
        activeItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const resultItems = activeItems.slice((page - 1) * pageSize, page * pageSize);
        await enrichMissingTimings(supabase, resultItems);
        return {
          siteId: snapshot.dashboard.site_id,
          total: activeItems.length,
          page,
          pageSize,
          items: resultItems,
          period: {
            start: input.periodStart,
            end: input.periodEnd,
          },
          query: input.query?.trim() || "",
        };
      }

      const combined = [...activeItems, ...parsed.items];
      combined.sort((a, b) => {
        const timeA = new Date(a.closedAt ?? a.createdAt).getTime();
        const timeB = new Date(b.closedAt ?? b.createdAt).getTime();
        return timeB - timeA;
      });

      const newTotal = parsed.total + activeItems.length;
      const resultItems = combined.slice(0, pageSize);
      await enrichMissingTimings(supabase, resultItems);
      return {
        ...parsed,
        total: newTotal,
        items: resultItems,
      };
    }
  }

  if (parsed && parsed.items.length > 0) {
    await enrichMissingTimings(supabase, parsed.items);
  }

  return parsed;
}

export async function getLaundryOrderHistoryDetail(orderId: string): Promise<LaundryOrderHistoryDetail | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_laundry_order_history_detail", {
    target_laundry_order_id: orderId,
  });

  const parsed = !error ? parseLaundryOrderHistoryDetail(data) : null;
  if (parsed) {
    if (!parsed.order.receivedAt && parsed.order.status !== "awaiting_receipt") {
      try {
        const { data: batches } = await supabase
          .from("laundry_batches")
          .select("created_at")
          .eq("laundry_order_id", orderId)
          .order("created_at", { ascending: true })
          .limit(1);

        if (batches?.[0]?.created_at) {
          parsed.order.receivedAt = batches[0].created_at;
        }
      } catch {
        // ignore batch query errors
      }
    }
    if (!parsed.order.readyAt && (parsed.order.status === "ready_for_pickup" || parsed.order.status === "picked_up")) {
      try {
        const { data: batches } = await supabase
          .from("laundry_batches")
          .select("loaded_at, completed_at")
          .eq("laundry_order_id", orderId)
          .in("status", ["completed", "loaded"]);

        if (batches && batches.length > 0) {
          let latestReady: string | null = null;
          for (const b of batches) {
            const time = b.loaded_at || b.completed_at;
            if (time && (!latestReady || new Date(time).getTime() > new Date(latestReady).getTime())) {
              latestReady = time;
            }
          }
          if (latestReady) {
            parsed.order.readyAt = latestReady;
          }
        }
      } catch {
        // ignore
      }
      if (!parsed.order.readyAt) {
        const readyEvent = parsed.events.filter((e) => [
          "laundry_batch_loaded_to_source_cart",
          "laundry_batch_completed_without_source_loading",
          "laundry_batch_drying_completed",
        ].includes(e.action)).at(-1)?.occurredAt;
        if (readyEvent) {
          parsed.order.readyAt = readyEvent;
        }
      }
    }
    if (parsed.order.receivedAt && !parsed.events.some((e) => e.action === "laundry_order_received")) {
      parsed.events.push({
        id: `received-${orderId}`,
        occurredAt: parsed.order.receivedAt,
        action: "laundry_order_received",
        outcome: "succeeded",
        reason: "收單並完成分類",
        batchId: null,
        equipmentName: null,
      });
      parsed.events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    }
    return parsed;
  }

  // Fallback for active orders: fetch from workspace order detail
  const [workspaceDetail, snapshot] = await Promise.all([
    getWorkspaceOrderDetail(orderId).catch(() => null),
    getWorkspaceSnapshot({ pageSize: 40 }).catch(() => null),
  ]);

  const activeOrder = snapshot?.orders?.find((o) => o.id === orderId);
  if (activeOrder) {
    const stageName = deriveStageName(activeOrder.status, workspaceDetail?.batches);
    const createdAt = workspaceDetail?.orderCreatedAt ?? activeOrder.updatedAt ?? new Date().toISOString();
    const receivedAt = workspaceDetail?.orderReceivedAt
      ?? (activeOrder.status !== "awaiting_receipt" ? (workspaceDetail?.orderCreatedAt ?? activeOrder.updatedAt) : null);
    const readyAt = workspaceDetail?.orderReadyAt
      ?? (activeOrder.status === "ready_for_pickup" || activeOrder.status === "picked_up" ? activeOrder.updatedAt : null);
    return {
      order: {
        id: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        status: activeOrder.status,
        stageName,
        createdAt,
        receivedAt: receivedAt ?? null,
        readyAt: readyAt ?? null,
        closedAt: null,
        institutionCode: "",
        institutionName: activeOrder.institutionName,
        cartNumber: activeOrder.cartNumber,
        siteCode: "MAIN",
        siteName: "本館",
      },
      batches: workspaceDetail?.batches ?? [],
      events: [],
    };
  }

  return null;
}
