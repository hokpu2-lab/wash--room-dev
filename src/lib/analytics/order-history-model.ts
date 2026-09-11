import { z } from "zod";

import type { WorkspaceBatchDetail } from "./workspace-snapshot";

const historyItemSchema = z.object({
  id: z.uuid(),
  order_number: z.string().min(1),
  status: z.literal("picked_up"),
  created_at: z.string(),
  closed_at: z.string(),
  institution_code: z.string().min(1),
  institution_name: z.string().min(1),
  cart_number: z.string().min(1),
  site_code: z.string().min(1),
  site_name: z.string().min(1),
});

const historyRpcSchema = z.object({
  outcome: z.literal("ok"),
  site_id: z.uuid(),
  period: z.object({
    start: z.string(),
    end: z.string(),
  }),
  queue: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    items: z.array(historyItemSchema),
  }),
});

const historyDetailBatchSchema = z.object({
  id: z.uuid(),
  batch_sequence: z.number().int().positive(),
  category_code: z.string().min(1),
  category_name: z.string().min(1),
  procedure_name: z.string().min(1),
  procedure_version: z.number().int().positive(),
  status: z.enum([
    "not_started",
    "in_progress",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "awaiting_cart",
    "loaded",
  ]),
  current_stage_order: z.number().int().positive(),
  active_equipment_name: z.string().min(1).nullable(),
  active_equipment_type: z.enum(["disinfection_tank", "washer", "dryer"]).nullable(),
  progress: z.object({
    stage_run_id: z.uuid().nullable(),
    stage_status: z.enum(["in_progress", "paused", "completed", "failed", "cancelled"]).nullable(),
    stage_progress_percent: z.number().min(0).max(100),
    overall_progress_percent: z.number().min(0).max(100),
    estimated_stage_completed_at: z.string().nullable(),
    overdue_minutes: z.number().int().nonnegative(),
    total_standard_minutes: z.number().int().nonnegative(),
    is_estimate: z.boolean(),
  }),
  stages: z.array(z.object({
    stage_order: z.number().int().positive(),
    name: z.string().min(1),
    standard_minutes: z.number().int().positive(),
    equipment_type: z.enum(["manual", "disinfection_tank", "washer", "dryer", "cart"]),
    state: z.enum(["pending", "active", "completed"]),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
  })),
});

const historyDetailEventSchema = z.object({
  id: z.uuid(),
  occurred_at: z.string(),
  action: z.string().min(1),
  outcome: z.literal("succeeded"),
  reason: z.string().nullable(),
  batch_id: z.uuid().nullable(),
  equipment_name: z.string().min(1).nullable(),
});

const historyDetailRpcSchema = z.object({
  outcome: z.literal("ok"),
  order: z.object({
    id: z.uuid(),
    order_number: z.string().min(1),
    status: z.literal("picked_up"),
    created_at: z.string(),
    closed_at: z.string(),
    institution_code: z.string().min(1),
    institution_name: z.string().min(1),
    cart_number: z.string().min(1),
    site_code: z.string().min(1),
    site_name: z.string().min(1),
  }),
  batches: z.array(historyDetailBatchSchema),
  events: z.array(historyDetailEventSchema),
});

export type LaundryOrderHistoryItem = {
  id: string;
  orderNumber: string;
  status: "picked_up";
  createdAt: string;
  closedAt: string;
  institutionCode: string;
  institutionName: string;
  cartNumber: string;
  siteCode: string;
  siteName: string;
};

export type LaundryOrderHistory = {
  siteId: string;
  period: { start: string; end: string };
  items: LaundryOrderHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
};

export type LaundryOrderHistoryDetailOrder = LaundryOrderHistoryItem;

export type LaundryOrderHistoryEvent = {
  id: string;
  occurredAt: string;
  action: string;
  outcome: "succeeded";
  reason: string | null;
  batchId: string | null;
  equipmentName: string | null;
};

export type LaundryOrderHistoryDetail = {
  order: LaundryOrderHistoryDetailOrder;
  batches: WorkspaceBatchDetail[];
  events: LaundryOrderHistoryEvent[];
};

export type LaundryOrderHistoryInput = {
  siteId?: string;
  institutionId?: string;
  periodStart: string;
  periodEnd: string;
  query?: string;
  page?: number;
  pageSize?: number;
};

export function parseLaundryOrderHistory(
  data: unknown,
  input: Pick<LaundryOrderHistoryInput, "query" | "page" | "pageSize">,
): LaundryOrderHistory | null {
  const parsed = historyRpcSchema.safeParse(data);
  if (!parsed.success) return null;

  const pageSize = Math.min(Math.max(input.pageSize ?? parsed.data.queue.limit, 1), 40);
  const page = Math.max(input.page ?? Math.floor(parsed.data.queue.offset / pageSize) + 1, 1);

  return {
    siteId: parsed.data.site_id,
    period: parsed.data.period,
    items: parsed.data.queue.items.map((item) => ({
      id: item.id,
      orderNumber: item.order_number,
      status: item.status,
      createdAt: item.created_at,
      closedAt: item.closed_at,
      institutionCode: item.institution_code,
      institutionName: item.institution_name,
      cartNumber: item.cart_number,
      siteCode: item.site_code,
      siteName: item.site_name,
    })),
    total: parsed.data.queue.total,
    page,
    pageSize,
    query: input.query?.trim() ?? "",
  };
}

export function parseLaundryOrderHistoryDetail(data: unknown): LaundryOrderHistoryDetail | null {
  const parsed = historyDetailRpcSchema.safeParse(data);
  if (!parsed.success) return null;

  return {
    order: {
      id: parsed.data.order.id,
      orderNumber: parsed.data.order.order_number,
      status: parsed.data.order.status,
      createdAt: parsed.data.order.created_at,
      closedAt: parsed.data.order.closed_at,
      institutionCode: parsed.data.order.institution_code,
      institutionName: parsed.data.order.institution_name,
      cartNumber: parsed.data.order.cart_number,
      siteCode: parsed.data.order.site_code,
      siteName: parsed.data.order.site_name,
    },
    batches: parsed.data.batches.map((batch) => ({
      id: batch.id,
      batchSequence: batch.batch_sequence,
      categoryCode: batch.category_code,
      categoryName: batch.category_name,
      procedureName: batch.procedure_name,
      procedureVersion: batch.procedure_version,
      status: batch.status,
      currentStageOrder: batch.current_stage_order,
      activeEquipmentName: batch.active_equipment_name,
      activeEquipmentType: batch.active_equipment_type,
      progress: {
        stageRunId: batch.progress.stage_run_id,
        stageStatus: batch.progress.stage_status,
        stageProgressPercent: batch.progress.stage_progress_percent,
        overallProgressPercent: batch.progress.overall_progress_percent,
        estimatedStageCompletedAt: batch.progress.estimated_stage_completed_at,
        overdueMinutes: batch.progress.overdue_minutes,
        totalStandardMinutes: batch.progress.total_standard_minutes,
        isEstimate: batch.progress.is_estimate,
      },
      stages: batch.stages.map((stage) => ({
        stageOrder: stage.stage_order,
        name: stage.name,
        standardMinutes: stage.standard_minutes,
        equipmentType: stage.equipment_type,
        state: stage.state,
        startedAt: stage.started_at,
        completedAt: stage.completed_at,
      })),
    })),
    events: parsed.data.events.map((event) => ({
      id: event.id,
      occurredAt: event.occurred_at,
      action: event.action,
      outcome: event.outcome,
      reason: event.reason,
      batchId: event.batch_id,
      equipmentName: event.equipment_name,
    })),
  };
}
