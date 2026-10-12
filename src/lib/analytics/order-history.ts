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

async function enrichMissingReceivedAt(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  items: LaundryOrderHistoryItem[],
): Promise<void> {
  const missing = items.filter((item) => !item.receivedAt && item.status !== "awaiting_receipt");
  if (missing.length === 0) return;

  const orderIds = missing.map((item) => item.id);
  try {
    const { data: batches } = await supabase
      .from("laundry_batches")
      .select("laundry_order_id, created_at")
      .in("laundry_order_id", orderIds);

    if (batches && batches.length > 0) {
      const batchMap = new Map<string, string>();
      for (const batch of batches) {
        const prev = batchMap.get(batch.laundry_order_id);
        if (!prev || new Date(batch.created_at).getTime() < new Date(prev).getTime()) {
          batchMap.set(batch.laundry_order_id, batch.created_at);
        }
      }
      for (const item of items) {
        if (!item.receivedAt && batchMap.has(item.id)) {
          item.receivedAt = batchMap.get(item.id)!;
        }
      }
    }
  } catch {
    // ignore batch query errors
  }

  // Second pass fallback for any remaining items with status !== awaiting_receipt
  const stillMissing = items.filter((item) => !item.receivedAt && item.status !== "awaiting_receipt");
  if (stillMissing.length > 0) {
    try {
      const stillMissingIds = stillMissing.map((item) => item.id);
      const { data: audits } = await supabase
        .from("authorization_audit_events")
        .select("laundry_order_id, occurred_at")
        .eq("action", "laundry_order_received")
        .eq("outcome", "succeeded")
        .in("laundry_order_id", stillMissingIds);

      if (audits && audits.length > 0) {
        const auditMap = new Map<string, string>();
        for (const audit of audits) {
          if (audit.laundry_order_id && !auditMap.has(audit.laundry_order_id)) {
            auditMap.set(audit.laundry_order_id, audit.occurred_at);
          }
        }
        for (const item of items) {
          if (!item.receivedAt && auditMap.has(item.id)) {
            item.receivedAt = auditMap.get(item.id)!;
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

      activeItems.push({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        stageName,
        createdAt: orderTimeIso,
        receivedAt: receivedAtIso ?? null,
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
        await enrichMissingReceivedAt(supabase, resultItems);
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
      await enrichMissingReceivedAt(supabase, resultItems);
      return {
        ...parsed,
        total: newTotal,
        items: resultItems,
      };
    }
  }

  if (parsed && parsed.items.length > 0) {
    await enrichMissingReceivedAt(supabase, parsed.items);
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
    return {
      order: {
        id: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        status: activeOrder.status,
        stageName,
        createdAt,
        receivedAt: receivedAt ?? null,
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
