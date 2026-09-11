import { z } from "zod";

export const dashboardSchema = z.object({
  site_id: z.uuid(),
  orders: z.object({
    awaiting_receipt: z.number(),
    in_process: z.number(),
    ready_for_pickup: z.number(),
    picked_up: z.number(),
  }),
  batches: z.object({
    not_started: z.number(),
    in_progress: z.number(),
    paused: z.number(),
    completed: z.number(),
  }),
  generated_at: z.string(),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

const orderStatusSchema = z.enum([
  "awaiting_receipt",
  "awaiting_cleaning",
  "in_process",
  "ready_for_pickup",
  "picked_up",
]);

const batchStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "awaiting_cart",
  "loaded",
]);

const batchProgressSchema = z.object({
  stage_run_id: z.uuid().nullable(),
  stage_status: z.enum(["in_progress", "paused", "completed", "failed", "cancelled"]).nullable(),
  stage_progress_percent: z.number().min(0).max(100),
  overall_progress_percent: z.number().min(0).max(100),
  estimated_stage_completed_at: z.string().nullable(),
  overdue_minutes: z.number().int().nonnegative(),
  total_standard_minutes: z.number().int().nonnegative(),
  is_estimate: z.boolean(),
});

const procedureStageSchema = z.object({
  stage_order: z.number().int().positive(),
  name: z.string().min(1),
  standard_minutes: z.number().int().positive(),
  equipment_type: z.enum(["manual", "disinfection_tank", "washer", "dryer", "cart"]),
  state: z.enum(["pending", "active", "completed"]),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

const orderDetailSchema = z.object({
  order_id: z.uuid(),
  order_created_at: z.string().nullable().optional(),
  order_received_at: z.string().nullable().optional(),
  order_ready_at: z.string().nullable().optional(),
  order_closed_at: z.string().nullable().optional(),
  batches: z.array(z.object({
    id: z.uuid(),
    batch_sequence: z.number().int().positive(),
    category_code: z.string().min(1),
    category_name: z.string().min(1),
    procedure_name: z.string().min(1),
    procedure_version: z.number().int().positive(),
    status: batchStatusSchema,
    current_stage_order: z.number().int().positive(),
    active_equipment_name: z.string().min(1).nullable(),
    active_equipment_type: z.enum(["disinfection_tank", "washer", "dryer"]).nullable(),
    progress: batchProgressSchema,
    stages: z.array(procedureStageSchema),
  })),
});

export const snapshotRpcSchema = z.object({
  outcome: z.literal("ok"),
  site_id: z.uuid(),
  period: z.object({
    start: z.string(),
    end: z.string(),
  }),
  orders: dashboardSchema.shape.orders,
  batches: dashboardSchema.shape.batches,
  queue: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    items: z.array(z.object({
      id: z.uuid(),
      order_number: z.string().min(1),
      status: orderStatusSchema,
      updated_at: z.string().nullable().optional(),
      institution_name: z.string().min(1),
      cart_number: z.string().min(1),
    })),
  }),
  open_batches: z.array(z.object({
    id: z.uuid(),
    status: batchStatusSchema,
    stage_order: z.number().int().positive(),
    order_number: z.string().min(1),
    category_name: z.string().min(1),
  })),
  order_details: z.array(orderDetailSchema).optional().default([]),
  equipment: z.array(z.object({
    id: z.uuid(),
    name: z.string().min(1),
    equipment_type: z.enum(["disinfection_tank", "washer", "dryer"]),
    status: z.enum(["normal", "inactive", "abnormal", "maintenance"]),
    occupied: z.boolean(),
  })),
  incidents: z.array(z.object({
    id: z.uuid(),
    incident_type: z.string().min(1),
    responsibility: z.string().min(1),
    reason: z.string().min(1),
    occurred_at: z.string(),
  })),
  generated_at: z.string(),
});

export type WorkspaceOrder = {
  id: string;
  orderNumber: string;
  status: z.infer<typeof orderStatusSchema>;
  updatedAt: string | null;
  institutionName: string;
  cartNumber: string;
};

export type WorkspaceBatch = {
  id: string;
  status: z.infer<typeof batchStatusSchema>;
  stageOrder: number;
  orderNumber: string;
  categoryName: string;
};

export type WorkspaceProcedureStage = {
  stageOrder: number;
  name: string;
  standardMinutes: number;
  equipmentType: "manual" | "disinfection_tank" | "washer" | "dryer" | "cart";
  state: "pending" | "active" | "completed";
  startedAt: string | null;
  completedAt: string | null;
};

export type WorkspaceBatchProgress = {
  stageRunId: string | null;
  stageStatus: "in_progress" | "paused" | "completed" | "failed" | "cancelled" | null;
  stageProgressPercent: number;
  overallProgressPercent: number;
  estimatedStageCompletedAt: string | null;
  overdueMinutes: number;
  totalStandardMinutes: number;
  isEstimate: boolean;
};

export type WorkspaceBatchDetail = {
  id: string;
  batchSequence: number;
  categoryCode: string;
  categoryName: string;
  procedureName: string;
  procedureVersion: number;
  status: z.infer<typeof batchStatusSchema>;
  currentStageOrder: number;
  activeEquipmentName: string | null;
  activeEquipmentType: "disinfection_tank" | "washer" | "dryer" | null;
  progress: WorkspaceBatchProgress;
  stages: WorkspaceProcedureStage[];
};

export function parseWorkspaceOrderDetail(data: unknown): WorkspaceOrderDetail | null {
  const parsed = orderDetailSchema.safeParse(data);
  if (!parsed.success) return null;
  const detail = parsed.data;
  return {
    orderId: detail.order_id,
    orderCreatedAt: detail.order_created_at ?? null,
    orderReceivedAt: detail.order_received_at ?? null,
    orderReadyAt: detail.order_ready_at ?? null,
    orderClosedAt: detail.order_closed_at ?? null,
    batches: detail.batches.map((batch) => ({
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
  };
}

export type WorkspaceOrderDetail = {
  orderId: string;
  orderCreatedAt: string | null;
  orderReceivedAt: string | null;
  orderReadyAt: string | null;
  orderClosedAt: string | null;
  batches: WorkspaceBatchDetail[];
};

export type WorkspaceEquipment = {
  id: string;
  name: string;
  equipmentType: "disinfection_tank" | "washer" | "dryer";
  status: "normal" | "inactive" | "abnormal" | "maintenance";
  occupied: boolean;
};

export type WorkspaceSnapshot = {
  dashboard: Dashboard;
  orders: WorkspaceOrder[];
  batches: WorkspaceBatch[];
  orderDetails: WorkspaceOrderDetail[];
  equipment: WorkspaceEquipment[];
  orderTotal: number;
  page: number;
  pageSize: number;
  query: string;
  generatedAt: string;
};

export function mergeWorkspaceSnapshots(
  parts: WorkspaceSnapshot[],
  input: { query?: string; page?: number; pageSize?: number } = {},
): WorkspaceSnapshot | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 40);
  const page = Math.max(input.page ?? 1, 1);
  const orders = parts.flatMap((part) => part.orders);
  const batches = parts.flatMap((part) => part.batches);
  const equipment = parts.flatMap((part) => part.equipment);
  const start = (page - 1) * pageSize;
  const visibleOrders = orders.slice(start, start + pageSize);
  const visibleOrderIds = new Set(visibleOrders.map((order) => order.id));
  return {
    dashboard: {
      site_id: parts[0]?.dashboard.site_id ?? "00000000-0000-4000-8000-000000000000",
      orders: {
        awaiting_receipt: parts.reduce((sum, part) => sum + part.dashboard.orders.awaiting_receipt, 0),
        in_process: parts.reduce((sum, part) => sum + part.dashboard.orders.in_process, 0),
        ready_for_pickup: parts.reduce((sum, part) => sum + part.dashboard.orders.ready_for_pickup, 0),
        picked_up: parts.reduce((sum, part) => sum + part.dashboard.orders.picked_up, 0),
      },
      batches: {
        not_started: parts.reduce((sum, part) => sum + part.dashboard.batches.not_started, 0),
        in_progress: parts.reduce((sum, part) => sum + part.dashboard.batches.in_progress, 0),
        paused: parts.reduce((sum, part) => sum + part.dashboard.batches.paused, 0),
        completed: parts.reduce((sum, part) => sum + part.dashboard.batches.completed, 0),
      },
      generated_at: parts[0]?.dashboard.generated_at ?? new Date().toISOString(),
    },
    orders: visibleOrders,
    batches,
    orderDetails: parts
      .flatMap((part) => part.orderDetails)
      .filter((detail) => visibleOrderIds.has(detail.orderId)),
    equipment,
    orderTotal: parts.reduce((sum, part) => sum + part.orderTotal, 0),
    page,
    pageSize,
    query: input.query?.trim() ?? "",
    generatedAt: parts[0]?.generatedAt ?? new Date().toISOString(),
  };
}

export function parseWorkspaceSnapshot(
  data: unknown,
  input: { query?: string; page?: number; pageSize?: number } = {},
): WorkspaceSnapshot | null {
  const parsed = snapshotRpcSchema.safeParse(data);
  if (!parsed.success) return null;
  const pageSize = Math.min(Math.max(input.pageSize ?? parsed.data.queue.limit, 1), 40);
  const page = Math.max(input.page ?? 1, 1);
  return {
    dashboard: {
      site_id: parsed.data.site_id,
      orders: parsed.data.orders,
      batches: parsed.data.batches,
      generated_at: parsed.data.generated_at,
    },
    orders: parsed.data.queue.items.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      updatedAt: row.updated_at ?? null,
      institutionName: row.institution_name,
      cartNumber: row.cart_number,
    })),
    batches: parsed.data.open_batches.map((row) => ({
      id: row.id,
      status: row.status,
      stageOrder: row.stage_order,
      orderNumber: row.order_number,
      categoryName: row.category_name,
    })),
    orderDetails: parsed.data.order_details
      .map((detail) => parseWorkspaceOrderDetail(detail))
      .filter((detail): detail is WorkspaceOrderDetail => detail !== null),
    equipment: parsed.data.equipment.map((row) => ({
      id: row.id,
      name: row.name,
      equipmentType: row.equipment_type,
      status: row.status,
      occupied: row.occupied,
    })),
    orderTotal: parsed.data.queue.total,
    page,
    pageSize,
    query: input.query?.trim() ?? "",
    generatedAt: parsed.data.generated_at,
  };
}
