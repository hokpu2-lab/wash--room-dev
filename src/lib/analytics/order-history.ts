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

      activeItems.push({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        stageName,
        createdAt: orderTimeIso,
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
        return {
          siteId: snapshot.dashboard.site_id,
          total: activeItems.length,
          page,
          pageSize,
          items: activeItems.slice((page - 1) * pageSize, page * pageSize),
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
      return {
        ...parsed,
        total: newTotal,
        items: combined.slice(0, pageSize),
      };
    }
  }

  return parsed;
}

export async function getLaundryOrderHistoryDetail(orderId: string): Promise<LaundryOrderHistoryDetail | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_laundry_order_history_detail", {
    target_laundry_order_id: orderId,
  });

  const parsed = !error ? parseLaundryOrderHistoryDetail(data) : null;
  if (parsed) return parsed;

  // Fallback for active orders: fetch from workspace order detail
  const [workspaceDetail, snapshot] = await Promise.all([
    getWorkspaceOrderDetail(orderId).catch(() => null),
    getWorkspaceSnapshot({ pageSize: 40 }).catch(() => null),
  ]);

  const activeOrder = snapshot?.orders?.find((o) => o.id === orderId);
  if (activeOrder) {
    const stageName = deriveStageName(activeOrder.status, workspaceDetail?.batches);
    const createdAt = workspaceDetail?.orderCreatedAt ?? activeOrder.updatedAt ?? new Date().toISOString();
    return {
      order: {
        id: activeOrder.id,
        orderNumber: activeOrder.orderNumber,
        status: activeOrder.status,
        stageName,
        createdAt,
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
