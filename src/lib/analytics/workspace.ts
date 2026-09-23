import "server-only";

import { z } from "zod";

import { requirePrincipal, requireRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  dashboardSchema,
  mergeWorkspaceSnapshots,
  parseWorkspaceOrderDetail,
  parseWorkspaceSnapshot,
  type Dashboard,
  type WorkspaceBatch,
  type WorkspaceEquipment,
  type WorkspaceOrder,
  type WorkspaceSnapshot,
} from "./workspace-snapshot";

export type { Dashboard, WorkspaceBatch, WorkspaceEquipment, WorkspaceOrder, WorkspaceSnapshot };

const namedSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});
const cartSchema = z.object({
  cart_number: z.string().min(1),
});
const relation = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.array(schema), z.null()]).optional();

const workspaceOrderRowSchema = z.object({
  id: z.uuid(),
  order_number: z.string().min(1),
  status: z.enum([
    "awaiting_receipt",
    "awaiting_cleaning",
    "in_process",
    "ready_for_pickup",
    "picked_up",
  ]),
  updated_at: z.string().nullable().optional(),
  institutions: relation(namedSchema),
  laundry_carts: relation(cartSchema),
});

const workspaceBatchRowSchema = z.object({
  id: z.uuid(),
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
  laundry_orders: relation(
    z.object({
      order_number: z.string().min(1),
      status: z.string().min(1),
    }),
  ),
  laundry_categories: relation(namedSchema),
});

const workspaceEquipmentRowSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  equipment_type: z.enum(["disinfection_tank", "washer", "dryer"]),
  status: z.enum(["normal", "inactive", "abnormal", "maintenance"]),
  occupied: z.boolean(),
});

async function fetchOneSnapshot(input: {
  siteId?: string;
  query?: string;
  page?: number;
  pageSize?: number;
}) {
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 40);
  const page = Math.max(input.page ?? 1, 1);
  const supabase = await createServerSupabaseClient();
  const rpcInput = {
    target_site_id: input.siteId ?? null,
    order_limit: pageSize,
    order_offset: (page - 1) * pageSize,
    order_query: input.query?.trim() || null,
  };
  let { data, error } = await supabase.rpc("get_workspace_snapshot_with_details", rpcInput);
  if (error) {
    ({ data, error } = await supabase.rpc("get_workspace_snapshot", rpcInput));
  }
  if (error) return loadLegacyWorkspaceSnapshot(input, page, pageSize);
  return parseWorkspaceSnapshot(data, { ...input, page, pageSize })
    ?? loadLegacyWorkspaceSnapshot(input, page, pageSize);
}

export async function getWorkspaceSnapshot(input: {
  siteId?: string;
  query?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<WorkspaceSnapshot | null> {
  if (input.siteId) return fetchOneSnapshot(input);
  const principal = await requirePrincipal();
  const siteIds = [...new Set(
    principal.memberships
      .map((membership) => membership.operating_site_id)
      .filter((siteId): siteId is string => Boolean(siteId)),
  )];
  if (siteIds.length <= 1) return fetchOneSnapshot({ ...input, siteId: siteIds[0] });
  const parts = await Promise.all(siteIds.map((siteId) => fetchOneSnapshot({ ...input, siteId, page: 1, pageSize: 40 })));
  return mergeWorkspaceSnapshots(parts.filter((part): part is WorkspaceSnapshot => part !== null), input);
}

async function loadLegacyWorkspaceSnapshot(
  input: { siteId?: string; query?: string },
  page: number,
  pageSize: number,
): Promise<WorkspaceSnapshot | null> {
  const supabase = await createServerSupabaseClient();
  const [{ data: dashboardData, error: dashboardError }, ordersResult, batchesResult, equipmentResult] =
    await Promise.all([
      supabase.rpc("get_laundry_dashboard", { target_site_id: input.siteId ?? null }),
      supabase
        .from("laundry_orders")
        .select("id,order_number,status,updated_at,institutions(code,name),laundry_carts(cart_number)")
        .neq("status", "picked_up")
        .order("updated_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1),
      supabase
        .from("laundry_batches")
        .select("id,status,current_stage_order,laundry_orders(order_number,status),laundry_categories(code,name)")
        .neq("status", "completed")
        .order("updated_at", { ascending: true })
        .limit(60),
      supabase.from("laundry_equipment").select("id,name,equipment_type,status,occupied").order("name").limit(24),
    ]);
  const dashboard = dashboardSchema.safeParse(dashboardData);
  if (dashboardError || !dashboard.success) return null;
  const needle = input.query?.trim().toLocaleLowerCase("zh-Hant") ?? "";
  const orderRows = z.array(workspaceOrderRowSchema).safeParse(ordersResult.data);
  const batchRows = z.array(workspaceBatchRowSchema).safeParse(batchesResult.data);
  const equipmentRows = z.array(workspaceEquipmentRowSchema).safeParse(equipmentResult.data);
  const orders = (orderRows.success ? orderRows.data : [])
    .map((row) => {
      const institution = firstRelation(row.institutions);
      const cart = firstRelation(row.laundry_carts);
      return {
        id: row.id,
        orderNumber: row.order_number,
        status: row.status,
        updatedAt: row.updated_at ?? null,
        institutionName: institution?.name ?? "送洗機構",
        cartNumber: cart?.cart_number ?? "—",
      };
    })
    .filter((order) => {
      if (!needle) return true;
      const statusLabels: Record<string, string> = {
        awaiting_receipt: "待收件",
        awaiting_cleaning: "待清洗",
        in_process: "處理中",
        ready_for_pickup: "待取件",
        picked_up: "已取件",
      };
      const statusLabel = (statusLabels[order.status] ?? "").toLocaleLowerCase("zh-Hant");
      return (
        order.orderNumber.toLocaleLowerCase("zh-Hant").includes(needle) ||
        order.institutionName.toLocaleLowerCase("zh-Hant").includes(needle) ||
        order.cartNumber.toLocaleLowerCase("zh-Hant").includes(needle) ||
        order.status.toLocaleLowerCase("zh-Hant").includes(needle) ||
        statusLabel.includes(needle)
      );
    });
  return {
    dashboard: dashboard.data,
    orders,
    batches: (batchRows.success ? batchRows.data : []).map((row) => {
      const order = firstRelation(row.laundry_orders);
      const category = firstRelation(row.laundry_categories);
      return {
        id: row.id,
        status: row.status,
        stageOrder: row.current_stage_order,
        orderNumber: order?.order_number ?? row.id.slice(0, 8),
        categoryName: category?.name ?? category?.code ?? "洗滌批次",
      };
    }),
    orderDetails: [],
    equipment: equipmentRows.success
      ? equipmentRows.data.map((row) => ({
          id: row.id,
          name: row.name,
          equipmentType: row.equipment_type,
          status: row.status,
          occupied: row.occupied,
        }))
      : [],
    orderTotal: orders.length,
    page,
    pageSize,
    query: input.query?.trim() ?? "",
    generatedAt: dashboard.data.generated_at,
  };
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function getWorkspaceOrderDetail(orderId: string) {
  const parsedId = z.uuid().safeParse(orderId);
  if (!parsedId.success) return null;
  await requirePrincipal();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_workspace_order_detail", {
    target_laundry_order_id: parsedId.data,
  });
  if (error || !data) return null;
  return parseWorkspaceOrderDetail(data);
}

export async function getDashboard(siteId?: string): Promise<Dashboard | null> {
  const snapshot = await getWorkspaceSnapshot({ siteId, pageSize: 1 });
  return snapshot?.dashboard ?? null;
}

export async function listWorkspaceOrders(): Promise<WorkspaceOrder[]> {
  return (await getWorkspaceSnapshot({ pageSize: 40 }))?.orders ?? [];
}

export async function listWorkspaceBatches(): Promise<WorkspaceBatch[]> {
  return (await getWorkspaceSnapshot({ pageSize: 1 }))?.batches ?? [];
}

export async function listWorkspaceEquipment(): Promise<WorkspaceEquipment[]> {
  return (await getWorkspaceSnapshot({ pageSize: 1 }))?.equipment ?? [];
}

export async function listSavedBiViews() {
  await requireRole("laundry_supervisor");
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("saved_bi_views")
    .select("id,name,dimensions,metrics,shared,created_at")
    .order("created_at", { ascending: false });
  return Array.isArray(data) ? data : [];
}

export async function runSavedBiView(viewId: string) {
  await requireRole("laundry_supervisor");
  const parsedId = z.uuid().safeParse(viewId);
  if (!parsedId.success) return null;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("run_laundry_bi_view", {
    target_view_id: parsedId.data,
  });
  return error || !data || data.outcome === "denied" ? null : data;
}

export async function summarizeDashboard() {
  const dashboard = await getDashboard();
  if (!dashboard) return null;
  const total = Object.values(dashboard.orders).reduce((sum, count) => sum + count, 0);
  const active = dashboard.orders.in_process + dashboard.batches.in_progress + dashboard.batches.paused;
  return {
    headline: active === 0 ? "目前沒有處理中的洗滌批次" : `目前有 ${active} 個處理中項目`,
    recommendations: [
      dashboard.orders.ready_for_pickup > 0 ? "優先安排可取件洗衣單" : "持續依排程處理待清洗批次",
      dashboard.batches.paused > 0 ? "檢查暫停批次與設備異常" : "維持目前設備配置",
    ],
    totals: { orders: total, active },
    aiEnabled: Boolean(process.env.OPENAI_API_KEY),
  };
}
