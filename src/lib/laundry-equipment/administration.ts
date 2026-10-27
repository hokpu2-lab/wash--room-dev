import "server-only";

import { z } from "zod";

import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole } from "@/lib/auth/principal";
import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";
import { renderFixedAssetQrSvg } from "@/lib/fixed-asset-qr";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseCleaningDurationConfig, resolveEquipmentDurationFromConfig } from "./duration-config";

const namedSiteSchema = z.object({ code: z.string(), name: z.string() });
const equipmentSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  equipment_type: z.enum(["disinfection_tank", "washer", "dryer"]),
  capacity_kg: z.coerce.number().int().nullable().optional(),
  cleaning_duration_minutes: z.coerce.number().int().min(1).max(1440).optional().default(60),
  cleaning_duration_config: z.record(z.string(), z.coerce.number().int().min(1).max(1440)).optional().default({ default: 60 }),
  status: z.enum(["normal", "inactive", "abnormal", "maintenance"]),
  occupied: z.boolean().optional().default(false),
  current_qr_version: z.number().int().positive(),
  operating_site_id: z.uuid().optional(),
  category_codes: z.array(z.string()).optional().default([]),
  procedure_template_ids: z.array(z.uuid()).optional().default([]),
  active_institutions: z.array(z.string()).optional().default([]),
  active_cart_count: z.number().int().nonnegative().optional().default(0),
  active_cart_numbers: z.array(z.string()).optional().default([]),
  active_category_code: z.string().nullable().optional(),
  active_category_name: z.string().nullable().optional(),
  active_duration_minutes: z.number().int().positive().nullable().optional(),
  operating_sites: z.union([namedSiteSchema, z.array(namedSiteSchema)]).transform((value) => (
    Array.isArray(value) ? value[0] ?? { code: "—", name: "—" } : value
  )),
});
const siteSchema = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

const categorySchema = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
const procedureSchema = z.object({
  id: z.uuid(),
  operating_site_id: z.uuid(),
  laundry_categories: z.union([categorySchema, z.array(categorySchema)]).nullish(),
  procedure_template_versions: z.array(z.object({ template_name: z.string(), status: z.string() })).optional(),
});
const workspaceSchema = z.object({
  equipment: z.array(equipmentSchema),
  categories: z.array(categorySchema),
  procedures: z.array(procedureSchema),
  sites: z.array(siteSchema),
});

const changeSchema = z.array(z.object({
  laundry_equipment_id: z.uuid().nullable(),
  qr_version: z.number().int().positive().nullable(),
  already_applied: z.boolean(),
  outcome: z.enum(["applied", "denied"]),
}));

const qrRowSchema = z.object({
  laundry_equipment_id: z.uuid(),
  equipment_name: z.string(),
  equipment_type: z.enum(["disinfection_tank", "washer", "dryer"]),
  qr_version: z.number().int().positive(),
  qr_token: z.string().regex(/^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/),
});
const qrSchema = z.union([z.array(qrRowSchema), qrRowSchema]);

export type LaundryEquipmentWorkspace = z.infer<typeof workspaceSchema>;
export type LaundryEquipmentCard = z.infer<typeof equipmentSchema>;
export type EquipmentChangeResult =
  | { kind: "applied" | "already-applied"; equipmentId: string; qrVersion: number }
  | { kind: "invalid" | "failed" | "denied"; reasonCode?: string; message?: string };
export type EquipmentDeletionResult =
  | { kind: "applied" | "already-applied"; equipmentId: string }
  | { kind: "invalid" | "failed" | "denied" | "in-use" | "name-mismatch" };

const registerInput = z.object({
  name: z.string().trim().min(1).max(80), siteCode: z.string().trim().min(1).max(40),
  equipmentType: z.enum(["disinfection_tank", "washer", "dryer"]), capacityKg: z.number().int().min(1).max(20).nullable(),
  cleaningDurationMinutes: z.coerce.number().int().min(1).max(1440).optional().default(60),
  cleaningDurationConfig: z.record(z.string(), z.coerce.number().int().min(1).max(1440)).optional(),
  categoryCodes: z.array(z.string().trim().min(1)).max(30), procedureTemplateIds: z.array(z.uuid()).max(30),
  requestId: z.uuid(), reason: z.string().trim().min(1).max(500),
});
const updateInput = z.object({
  equipmentId: z.uuid(), name: z.string().trim().min(1).max(80), capacityKg: z.number().int().min(1).max(20).nullable(),
  cleaningDurationMinutes: z.coerce.number().int().min(1).max(1440).optional().default(60),
  cleaningDurationConfig: z.record(z.string(), z.coerce.number().int().min(1).max(1440)).optional(),
  status: z.enum(["normal", "inactive", "abnormal", "maintenance"]), categoryCodes: z.array(z.string()).max(30), procedureTemplateIds: z.array(z.uuid()).max(30), requestId: z.uuid(), reason: z.string().trim().min(1).max(500),
});
const reissueInput = z.object({ equipmentId: z.uuid(), requestId: z.uuid(), reason: z.string().trim().min(1).max(500), confirmed: z.literal(true) });
const deleteInput = z.object({
  equipmentId: z.uuid(),
  expectedName: z.string().trim().min(1).max(80),
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  confirmed: z.literal(true),
});
const deletionSchema = z.array(z.object({
  laundry_equipment_id: z.uuid().nullable(),
  already_applied: z.boolean(),
  outcome: z.enum(["applied", "denied"]),
  reason_code: z.enum(["deleted", "in_use", "name_mismatch", "scope_denied"]),
}));

export async function getLaundryEquipmentWorkspace(): Promise<LaundryEquipmentWorkspace> {
  const principal = await requireRole("laundry_supervisor");
  const scope = await resolveWorkspaceScope();
  const allSiteIds = principal.memberships.filter((m) => isLaundrySupervisorRole(m.role)).map((m) => m.operating_site_id).filter((id): id is string => id !== null);
  const siteIds = scope.siteId && allSiteIds.includes(scope.siteId) ? [scope.siteId] : allSiteIds;
  const supabase = await createServerSupabaseClient();
  const [
    equipmentResult,
    categoryResult,
    procedureResult,
    siteResult,
    categoryCapResult,
    procedureCapResult,
    activeRunsResult,
    activeBatchesResult,
    allCartsResult,
    allOrdersResult,
    allSourcesResult,
  ] = await Promise.all([
    supabase.from("laundry_equipment").select("id, name, equipment_type, capacity_kg, status, occupied, current_qr_version, operating_site_id, operating_sites(code, name)").in("operating_site_id", siteIds).order("name", { ascending: true }),
    supabase.from("laundry_categories").select("id, code, name").eq("active", true).order("sort_order", { ascending: true }),
    supabase.from("procedure_templates").select("id, operating_site_id, laundry_categories(id, code, name), procedure_template_versions(template_name, status)").in("operating_site_id", siteIds),
    supabase.from("operating_sites").select("id, code, name").in("id", siteIds).order("code", { ascending: true }),
    supabase.from("laundry_equipment_categories").select("laundry_equipment_id, laundry_categories(code)"),
    supabase.from("laundry_equipment_procedures").select("laundry_equipment_id, procedure_template_id"),
    supabase.from("laundry_batch_stage_runs").select("id, laundry_equipment_id, laundry_batch_id, status").in("operating_site_id", siteIds),
    supabase.from("laundry_batches").select("id, source_laundry_cart_id, laundry_order_id, status, active_stage_run_id, laundry_categories(code, name)").in("operating_site_id", siteIds),
    supabase.from("laundry_carts").select("id, cart_number, institutions(name)"),
    supabase.from("laundry_orders").select("id, laundry_cart_id").in("operating_site_id", siteIds),
    supabase.from("laundry_batch_sources").select("shared_batch_id, source_laundry_cart_id, laundry_order_id").in("operating_site_id", siteIds),
  ]);
  const categoryCaps = new Map<string, string[]>();
  for (const row of categoryCapResult.data ?? []) {
    const related = row.laundry_categories as { code?: string } | Array<{ code?: string }> | null;
    const code = Array.isArray(related) ? related[0]?.code : related?.code;
    if (typeof row.laundry_equipment_id === "string" && typeof code === "string") {
      categoryCaps.set(row.laundry_equipment_id, [...(categoryCaps.get(row.laundry_equipment_id) ?? []), code]);
    }
  }
  const procedureCaps = new Map<string, string[]>();
  for (const row of procedureCapResult.data ?? []) {
    if (typeof row.laundry_equipment_id === "string" && typeof row.procedure_template_id === "string") {
      procedureCaps.set(row.laundry_equipment_id, [
        ...(procedureCaps.get(row.laundry_equipment_id) ?? []),
        row.procedure_template_id,
      ]);
    }
  }

  const cartMap = new Map<string, string>();
  const cartToInstMap = new Map<string, string>();
  for (const cart of (allCartsResult.data ?? []) as Array<{ id?: string; cart_number?: string; institutions?: { name?: string } | Array<{ name?: string }> | null }>) {
    if (cart.id && cart.cart_number) {
      cartMap.set(cart.id, cart.cart_number);
      const inst = Array.isArray(cart.institutions) ? cart.institutions[0]?.name : cart.institutions?.name;
      if (inst) cartToInstMap.set(cart.id, inst);
    }
  }

  const orderToCartIdMap = new Map<string, string>();
  for (const order of (allOrdersResult.data ?? []) as Array<{ id?: string; laundry_cart_id?: string }>) {
    if (order.id && order.laundry_cart_id) {
      orderToCartIdMap.set(order.id, order.laundry_cart_id);
    }
  }

  const batchSourcesMap = new Map<string, Array<{ source_laundry_cart_id?: string | null; laundry_order_id?: string | null }>>();
  for (const src of (allSourcesResult.data ?? []) as Array<{ shared_batch_id?: string; source_laundry_cart_id?: string | null; laundry_order_id?: string | null }>) {
    if (src.shared_batch_id) {
      batchSourcesMap.set(src.shared_batch_id, [...(batchSourcesMap.get(src.shared_batch_id) ?? []), src]);
    }
  }

  function extractCategory(value: unknown): { code?: string; name?: string } | null {
    if (!value) return null;
    const item = Array.isArray(value) ? value[0] : value;
    if (!item || typeof item !== "object") return null;
    return {
      code: "code" in item && typeof item.code === "string" ? item.code : undefined,
      name: "name" in item && typeof item.name === "string" ? item.name : undefined,
    };
  }

  type BatchMapEntry = {
    id: string;
    source_laundry_cart_id?: string | null;
    laundry_order_id?: string | null;
    status?: string | null;
    active_stage_run_id?: string | null;
    categoryCode?: string;
    categoryName?: string;
  };

  const batchMap = new Map<string, BatchMapEntry>();
  for (const batch of (activeBatchesResult.data ?? []) as Array<{
    id: string;
    source_laundry_cart_id?: string | null;
    laundry_order_id?: string | null;
    status?: string | null;
    active_stage_run_id?: string | null;
    laundry_categories?: unknown;
  }>) {
    if (batch.id) {
      const cat = extractCategory(batch.laundry_categories);
      batchMap.set(batch.id, {
        id: batch.id,
        source_laundry_cart_id: batch.source_laundry_cart_id,
        laundry_order_id: batch.laundry_order_id,
        status: batch.status,
        active_stage_run_id: batch.active_stage_run_id,
        categoryCode: cat?.code,
        categoryName: cat?.name,
      });
    }
  }

  const runToBatchMap = new Map<string, { equipId: string; batchId: string }>();
  for (const run of (activeRunsResult.data ?? []) as Array<{ id?: string; laundry_equipment_id?: string | null; laundry_batch_id?: string | null; status?: string | null }>) {
    if (run.id && run.laundry_equipment_id && run.laundry_batch_id && (run.status === "in_progress" || run.status === "paused")) {
      runToBatchMap.set(run.id, { equipId: run.laundry_equipment_id, batchId: run.laundry_batch_id });
    }
  }

  type EquipmentUsage = {
    cartNumbers: Set<string>;
    institutions: Set<string>;
    cartCount: number;
    categoryCodes: Set<string>;
    categoryNames: Set<string>;
  };

  const equipmentUsageMap = new Map<string, EquipmentUsage>();
  for (const run of (activeRunsResult.data ?? []) as Array<{ id?: string; laundry_equipment_id?: string | null; laundry_batch_id?: string | null; status?: string | null }>) {
    const isRunActive = run.status === "in_progress" || run.status === "paused";
    if (!isRunActive) continue;
    const equipId = run.laundry_equipment_id;
    const batchId = run.laundry_batch_id;
    if (!equipId) continue;

    const current: EquipmentUsage = equipmentUsageMap.get(equipId) ?? {
      cartNumbers: new Set<string>(),
      institutions: new Set<string>(),
      cartCount: 0,
      categoryCodes: new Set<string>(),
      categoryNames: new Set<string>(),
    };

    if (batchId) {
      const batch = batchMap.get(batchId);
      if (batch?.categoryCode) current.categoryCodes.add(batch.categoryCode);
      if (batch?.categoryName) current.categoryNames.add(batch.categoryName);

      const sources = batchSourcesMap.get(batchId) ?? [];
      if (sources.length > 0) {
        current.cartCount += sources.length;
        for (const src of sources) {
          const cartId = src.source_laundry_cart_id || (src.laundry_order_id ? orderToCartIdMap.get(src.laundry_order_id) : null);
          const cartNum = cartId ? cartMap.get(cartId) : null;
          if (cartNum) current.cartNumbers.add(cartNum);
          const inst = cartId ? cartToInstMap.get(cartId) : null;
          if (inst) current.institutions.add(inst);
        }
      } else {
        current.cartCount += 1;
        const cartId = batch?.source_laundry_cart_id || (batch?.laundry_order_id ? orderToCartIdMap.get(batch.laundry_order_id) : null);
        const cartNum = cartId ? cartMap.get(cartId) : null;
        if (cartNum) current.cartNumbers.add(cartNum);
        const inst = cartId ? cartToInstMap.get(cartId) : null;
        if (inst) current.institutions.add(inst);
      }
    }
    equipmentUsageMap.set(equipId, current);
  }

  for (const batch of (activeBatchesResult.data ?? []) as Array<{ id: string; source_laundry_cart_id?: string | null; laundry_order_id?: string | null; status?: string | null; active_stage_run_id?: string | null; laundry_categories?: unknown }>) {
    if (batch.active_stage_run_id) {
      const runInfo = runToBatchMap.get(batch.active_stage_run_id);
      if (runInfo?.equipId) {
        const current: EquipmentUsage = equipmentUsageMap.get(runInfo.equipId) ?? {
          cartNumbers: new Set<string>(),
          institutions: new Set<string>(),
          cartCount: 0,
          categoryCodes: new Set<string>(),
          categoryNames: new Set<string>(),
        };
        const cat = extractCategory(batch.laundry_categories);
        if (cat?.code) current.categoryCodes.add(cat.code);
        if (cat?.name) current.categoryNames.add(cat.name);

        const cartId = batch.source_laundry_cart_id || (batch.laundry_order_id ? orderToCartIdMap.get(batch.laundry_order_id) : null);
        const cartNum = cartId ? cartMap.get(cartId) : null;
        if (cartNum) current.cartNumbers.add(cartNum);
        const inst = cartId ? cartToInstMap.get(cartId) : null;
        if (inst) current.institutions.add(inst);
        equipmentUsageMap.set(runInfo.equipId, current);
      }
    }
  }

  for (const item of (equipmentResult.data ?? []) as Array<{ id: string; name?: string; occupied?: boolean }>) {
    if (item.occupied) {
      const current: EquipmentUsage = equipmentUsageMap.get(item.id) ?? {
        cartNumbers: new Set<string>(),
        institutions: new Set<string>(),
        cartCount: 1,
        categoryCodes: new Set<string>(),
        categoryNames: new Set<string>(),
      };
      if (current.cartNumbers.size === 0) {
        for (const batch of (activeBatchesResult.data ?? []) as Array<{ id: string; source_laundry_cart_id?: string | null; laundry_order_id?: string | null; status?: string | null; laundry_categories?: unknown }>) {
          if (batch.status === "in_progress" || batch.status === "paused") {
            const cartId = batch.source_laundry_cart_id || (batch.laundry_order_id ? orderToCartIdMap.get(batch.laundry_order_id) : null);
            const cartNum = cartId ? cartMap.get(cartId) : null;
            if (cartNum) current.cartNumbers.add(cartNum);
            const inst = cartId ? cartToInstMap.get(cartId) : null;
            if (inst) current.institutions.add(inst);

            const cat = extractCategory(batch.laundry_categories);
            if (cat?.code) current.categoryCodes.add(cat.code);
            if (cat?.name) current.categoryNames.add(cat.name);
          }
        }
      }
      equipmentUsageMap.set(item.id, current);
    }
  }

  type EquipmentDbRow = {
    id: string;
    name: string;
    equipment_type: "disinfection_tank" | "washer" | "dryer";
    capacity_kg: number | null;
    status: "normal" | "inactive" | "abnormal" | "maintenance";
    occupied: boolean;
    current_qr_version: number;
    operating_site_id?: string;
    operating_sites?: { code: string; name: string } | Array<{ code: string; name: string }>;
    cleaning_duration_minutes?: number;
    cleaning_duration_config?: Record<string, number>;
  };

  let equipmentRows = (equipmentResult.data ?? []) as EquipmentDbRow[];

  // 彈性回補：若資料庫已遷移 cleaning_duration_minutes 或 cleaning_duration_config 欄位則動態讀取，否則預設 60 分鐘
  try {
    let durationRows: Array<{ id: string; cleaning_duration_minutes?: number; cleaning_duration_config?: unknown }> | null = null;
    const fullRes = await supabase
      .from("laundry_equipment")
      .select("id, cleaning_duration_minutes, cleaning_duration_config")
      .in("operating_site_id", siteIds);
    if (fullRes.data && !fullRes.error) {
      durationRows = fullRes.data as Array<{ id: string; cleaning_duration_minutes?: number; cleaning_duration_config?: unknown }>;
    } else {
      const simpleRes = await supabase
        .from("laundry_equipment")
        .select("id, cleaning_duration_minutes")
        .in("operating_site_id", siteIds);
      if (simpleRes.data && !simpleRes.error) {
        durationRows = simpleRes.data as Array<{ id: string; cleaning_duration_minutes?: number }>;
      }
    }

    if (durationRows) {
      const durMap = new Map<string, number>();
      const configMap = new Map<string, Record<string, number>>();
      for (const row of durationRows) {
        if (row.id) {
          if (typeof row.cleaning_duration_minutes === "number") {
            durMap.set(row.id, row.cleaning_duration_minutes);
          }
          if (row.cleaning_duration_config) {
            configMap.set(row.id, parseCleaningDurationConfig(row.cleaning_duration_config, row.cleaning_duration_minutes ?? 60));
          }
        }
      }
      equipmentRows = equipmentRows.map((item) => {
        const mins = durMap.get(item.id) ?? 60;
        const conf = configMap.get(item.id) ?? { default: mins };
        return {
          ...item,
          cleaning_duration_minutes: mins,
          cleaning_duration_config: conf,
        };
      });
    }
  } catch {
    // 遠端資料庫未遷移該欄位時不拋錯，平滑保留預設值 60
  }

  const workspace = workspaceSchema.safeParse({
    equipment: equipmentRows.map((item) => {
      const usage = equipmentUsageMap.get(item.id);
      const isOccupied = item.status === "normal" && Boolean(item.occupied || (usage && usage.cartCount > 0));
      const config = item.cleaning_duration_config ?? { default: item.cleaning_duration_minutes ?? 60 };
      const activeCategoryCode = isOccupied && usage && usage.categoryCodes.size > 0 ? Array.from(usage.categoryCodes)[0] : null;
      const activeCategoryName = isOccupied && usage && usage.categoryNames.size > 0 ? Array.from(usage.categoryNames)[0] : null;
      const activeDuration = isOccupied
        ? resolveEquipmentDurationFromConfig(
            config,
            activeCategoryCode || activeCategoryName,
            item.cleaning_duration_minutes ?? config.default ?? 60,
            item.equipment_type
          )
        : null;

      return {
        ...item,
        occupied: isOccupied,
        capacity_kg: 1,
        cleaning_duration_minutes: item.cleaning_duration_minutes ?? config.default ?? 60,
        cleaning_duration_config: config,
        category_codes: categoryCaps.get(item.id) ?? [],
        procedure_template_ids: procedureCaps.get(item.id) ?? [],
        active_institutions: isOccupied && usage && usage.institutions.size > 0 ? Array.from(usage.institutions) : [],
        active_cart_count: isOccupied ? (usage ? usage.cartCount : 1) : 0,
        active_cart_numbers: isOccupied && usage && usage.cartNumbers.size > 0 ? Array.from(usage.cartNumbers) : [],
        active_category_code: activeCategoryCode,
        active_category_name: activeCategoryName,
        active_duration_minutes: activeDuration,
      };
    }),
    categories: categoryResult.data ?? [],
    procedures: procedureResult.data ?? [],
    sites: siteResult.data ?? [],
  });
  if (!workspace.success) {
    console.error("Workspace parse failed:", workspace.error);
    return { equipment: [], categories: [], procedures: [], sites: [] };
  }
  return workspace.data;
}

export async function getLaundryEquipmentCard(id: unknown): Promise<LaundryEquipmentCard | null> {
  const parsed = z.uuid().safeParse(id); if (!parsed.success) return null;
  const workspace = await getLaundryEquipmentWorkspace();
  return workspace.equipment.find((item) => item.id === parsed.data) ?? null;
}

export async function registerLaundryEquipment(input: unknown): Promise<EquipmentChangeResult> {
  await requireRole("laundry_supervisor"); const parsed = registerInput.safeParse(input); if (!parsed.success) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  let { data, error } = await supabase.rpc("register_laundry_equipment", {
    requested_name: parsed.data.name.toUpperCase(),
    target_site_code: parsed.data.siteCode.toUpperCase(),
    target_equipment_type: parsed.data.equipmentType,
    target_capacity_kg: parsed.data.capacityKg,
    target_category_codes: parsed.data.categoryCodes.map((code) => code.toUpperCase()),
    target_procedure_template_ids: parsed.data.procedureTemplateIds,
    change_request_id: parsed.data.requestId,
    change_reason: parsed.data.reason,
    target_cleaning_duration_minutes: parsed.data.cleaningDurationMinutes ?? 60,
  });
  if (error && (error.code === "42883" || error.message?.includes("function"))) {
    const fallback = await supabase.rpc("register_laundry_equipment", {
      requested_name: parsed.data.name.toUpperCase(),
      target_site_code: parsed.data.siteCode.toUpperCase(),
      target_equipment_type: parsed.data.equipmentType,
      target_capacity_kg: parsed.data.capacityKg,
      target_category_codes: parsed.data.categoryCodes.map((code) => code.toUpperCase()),
      target_procedure_template_ids: parsed.data.procedureTemplateIds,
      change_request_id: parsed.data.requestId,
      change_reason: parsed.data.reason,
    });
    data = fallback.data;
    error = fallback.error;
  }
  const result = changeSchema.safeParse(data); if (error || !result.success || result.data.length !== 1) return { kind: "failed" };
  const change = result.data[0]; if (change.outcome === "denied") return { kind: "denied" }; if (!change.laundry_equipment_id || change.qr_version === null) return { kind: "failed" };
  if (parsed.data.cleaningDurationConfig && change.laundry_equipment_id) {
    try {
      await supabase
        .from("laundry_equipment")
        .update({
          cleaning_duration_config: parsed.data.cleaningDurationConfig,
          cleaning_duration_minutes: parsed.data.cleaningDurationConfig.default ?? parsed.data.cleaningDurationMinutes ?? 60,
        })
        .eq("id", change.laundry_equipment_id);
    } catch {}
  }
  return { kind: change.already_applied ? "already-applied" : "applied", equipmentId: change.laundry_equipment_id, qrVersion: change.qr_version };
}

export async function updateLaundryEquipment(input: unknown): Promise<EquipmentChangeResult> {
  await requireRole("laundry_supervisor");
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) {
    console.error("updateLaundryEquipment validation error:", parsed.error.format());
    const hasReasonIssue = parsed.error.issues.some((issue) => issue.path.includes("reason"));
    if (hasReasonIssue) {
      return { kind: "invalid", reasonCode: "reason_required", message: "請填寫異動理由（必填稽核項目）" };
    }
    return { kind: "invalid", reasonCode: "invalid_fields", message: "表單資料格式不正確或缺少必填資料" };
  }
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  let { data, error } = await supabase.rpc("update_laundry_equipment", {
    target_laundry_equipment_id: parsed.data.equipmentId,
    requested_name: parsed.data.name.toUpperCase(),
    target_capacity_kg: parsed.data.capacityKg,
    target_status: parsed.data.status,
    target_category_codes: parsed.data.categoryCodes.map((code) => code.toUpperCase()),
    target_procedure_template_ids: parsed.data.procedureTemplateIds,
    change_request_id: parsed.data.requestId,
    change_reason: parsed.data.reason,
    target_cleaning_duration_minutes: parsed.data.cleaningDurationMinutes ?? 60,
  });
  if (error && (error.code === "42883" || error.message?.includes("function"))) {
    const fallback = await supabase.rpc("update_laundry_equipment", {
      target_laundry_equipment_id: parsed.data.equipmentId,
      requested_name: parsed.data.name.toUpperCase(),
      target_capacity_kg: parsed.data.capacityKg,
      target_status: parsed.data.status,
      target_category_codes: parsed.data.categoryCodes.map((code) => code.toUpperCase()),
      target_procedure_template_ids: parsed.data.procedureTemplateIds,
      change_request_id: parsed.data.requestId,
      change_reason: parsed.data.reason,
    });
    data = fallback.data;
    error = fallback.error;
  }
  if (error) {
    console.error("updateLaundryEquipment RPC error:", error);
    const msg = error.message || "";
    if (msg.includes("procedure requires a different equipment type") || msg.includes("incompatible procedure capability")) {
      return { kind: "failed", reasonCode: "procedure_incompatible", message: "所選相容程序與設備機型不符，請調整相容程序勾選" };
    }
    if (msg.includes("is_safe_laundry_equipment_change_reason") || msg.includes("invalid laundry equipment update")) {
      return { kind: "invalid", reasonCode: "reason_required", message: "異動理由未填寫或不符合安全規範" };
    }
    if (msg.includes("authentication required")) {
      return { kind: "denied", reasonCode: "auth_required", message: "尚未登入或認證過期" };
    }
    return { kind: "failed", reasonCode: "database_error", message: msg };
  }
  const result = changeSchema.safeParse(data);
  if (!result.success || result.data.length !== 1) {
    console.error("updateLaundryEquipment parse error:", result.error, "data:", data);
    return { kind: "failed", reasonCode: "parse_error" };
  }
  const change = result.data[0];
  if (change.outcome === "denied") {
    return { kind: "denied", reasonCode: "site_scope_denied", message: "權限不足：你沒有此設備所在作業據點的主管權限" };
  }
  if (!change.laundry_equipment_id || change.qr_version === null) {
    return { kind: "failed", reasonCode: "empty_equipment" };
  }
  if (parsed.data.cleaningDurationConfig && change.laundry_equipment_id) {
    try {
      await supabase
        .from("laundry_equipment")
        .update({
          cleaning_duration_config: parsed.data.cleaningDurationConfig,
          cleaning_duration_minutes: parsed.data.cleaningDurationConfig.default ?? parsed.data.cleaningDurationMinutes ?? 60,
        })
        .eq("id", change.laundry_equipment_id);
    } catch {}
  }

  // 若設備被更新為「已停用」、「異常故障」或「維修中」，在洗衣設備中的洗衣車自動返回上一步，釋放設備並聯動所有相關狀態
  const isTargetNotNormal = parsed.data.status !== "normal";
  if (isTargetNotNormal && change.laundry_equipment_id) {
    try {
      // 1. 強制確保設備狀態解除佔用
      await supabase
        .from("laundry_equipment")
        .update({
          occupied: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", change.laundry_equipment_id);

      // 2. 查詢該設備上所有進行中或暫停中的 stage runs
      const { data: activeRuns } = await supabase
        .from("laundry_batch_stage_runs")
        .select("id, laundry_batch_id, stage_order, status")
        .eq("laundry_equipment_id", change.laundry_equipment_id)
        .in("status", ["in_progress", "paused"]);

      const batchIdsToRevert = new Set<string>();
      if (activeRuns && activeRuns.length > 0) {
        for (const run of activeRuns) {
          if (run.laundry_batch_id) {
            batchIdsToRevert.add(run.laundry_batch_id);
          }
        }
      }

      const statusText =
        parsed.data.status === "inactive"
          ? "設備已停用"
          : parsed.data.status === "abnormal"
          ? "設備故障異常"
          : "設備維修保養中";
      const revertReason = `設備狀態變更為【${statusText}】自動退回待處理：${parsed.data.reason || "機台異常/維修/停用退回"}`;

      for (const batchId of batchIdsToRevert) {
        let reversedViaRpc = false;
        try {
          const rpcRes = await supabase.rpc("reverse_last_laundry_batch_operation", {
            target_laundry_batch_id: batchId,
            reversal_reason: revertReason.slice(0, 500),
            change_request_id: crypto.randomUUID(),
          });
          if (rpcRes.data && Array.isArray(rpcRes.data) && rpcRes.data[0]?.outcome === "applied") {
            reversedViaRpc = true;
          }
        } catch (rpcErr) {
          console.warn("reverse_last_laundry_batch_operation RPC failed, fallback to direct revert:", rpcErr);
        }

        // 若 RPC 未能還原（例如批次處於 paused 或 RPC 限制），執行安全直接更新退回上一步
        if (!reversedViaRpc) {
          try {
            // 查詢批次詳細資訊
            const { data: batchData } = await supabase
              .from("laundry_batches")
              .select("id, laundry_order_id, operating_site_id, current_stage_order, status, active_stage_run_id")
              .eq("id", batchId)
              .single();

            // 將該設備上關聯的 stage runs 設為 cancelled
            await supabase
              .from("laundry_batch_stage_runs")
              .update({
                status: "cancelled",
                updated_at: new Date().toISOString(),
              })
              .eq("laundry_equipment_id", change.laundry_equipment_id)
              .in("status", ["in_progress", "paused"]);

            // 將批次狀態重設為 not_started，清空 active_stage_run_id
            await supabase
              .from("laundry_batches")
              .update({
                status: "not_started",
                active_stage_run_id: null,
                completed_at: null,
                loaded_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", batchId);

            // 更新洗衣單狀態
            if (batchData?.laundry_order_id) {
              const isFirstStage = (batchData.current_stage_order ?? 1) <= 1;
              let targetOrderStatus = "in_process";
              if (isFirstStage) {
                const { data: siblingBatches } = await supabase
                  .from("laundry_batches")
                  .select("id, status")
                  .eq("laundry_order_id", batchData.laundry_order_id)
                  .neq("id", batchId);

                const anySiblingActive = siblingBatches?.some(
                  (b) => b.status !== "not_started" && b.status !== "cancelled"
                );
                if (!anySiblingActive) {
                  targetOrderStatus = "awaiting_cleaning";
                }
              }
              await supabase
                .from("laundry_orders")
                .update({
                  status: targetOrderStatus,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", batchData.laundry_order_id);
            }

            // 寫入更正稽核紀錄
            try {
              const userRes = await supabase.auth.getUser();
              const userId = userRes?.data?.user?.id;
              if (userId) {
                await supabase.from("laundry_data_corrections").insert({
                  laundry_batch_id: batchId,
                  correction_kind: "reopen",
                  reason: revertReason.slice(0, 500),
                  before_state: {
                    equipment_id: change.laundry_equipment_id,
                    equipment_status: parsed.data.status,
                    previous_batch_status: batchData?.status,
                  },
                  after_state: {
                    equipment_occupied: false,
                    batch_status: "not_started",
                    stage_run_status: "cancelled",
                  },
                  corrected_by_auth_user_id: userId,
                });
              }
            } catch (auditErr) {
              console.warn("Insert laundry_data_corrections failed:", auditErr);
            }
          } catch (directErr) {
            console.error("Direct batch revert failed:", directErr);
          }
        }
      }

      // 最後再度確認設備 occupied 為 false
      await supabase
        .from("laundry_equipment")
        .update({
          occupied: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", change.laundry_equipment_id);
    } catch (err) {
      console.error("Auto revert cart on equipment status change error:", err);
    }
  }

  return { kind: change.already_applied ? "already-applied" : "applied", equipmentId: change.laundry_equipment_id, qrVersion: change.qr_version };
}

export async function reissueLaundryEquipmentQr(input: unknown): Promise<EquipmentChangeResult> {
  await requireRole("laundry_supervisor"); const parsed = reissueInput.safeParse(input); if (!parsed.success) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("reissue_laundry_equipment_qr", { target_laundry_equipment_id: parsed.data.equipmentId, change_request_id: parsed.data.requestId, change_reason: parsed.data.reason });
  const result = changeSchema.safeParse(data); if (error || !result.success || result.data.length !== 1) return { kind: "failed" }; const change = result.data[0]; if (change.outcome === "denied") return { kind: "denied" }; if (!change.laundry_equipment_id || change.qr_version === null) return { kind: "failed" };
  return { kind: change.already_applied ? "already-applied" : "applied", equipmentId: change.laundry_equipment_id, qrVersion: change.qr_version };
}

export async function deleteUnusedLaundryEquipment(input: unknown): Promise<EquipmentDeletionResult> {
  await requireRole("laundry_supervisor");
  const parsed = deleteInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("delete_unused_laundry_equipment", {
    target_laundry_equipment_id: parsed.data.equipmentId,
    expected_equipment_name: parsed.data.expectedName,
    change_request_id: parsed.data.requestId,
    change_reason: parsed.data.reason,
  });
  const result = deletionSchema.safeParse(data);
  if (error || !result.success || result.data.length !== 1) return { kind: "failed" };
  const deletion = result.data[0];
  if (deletion.outcome === "denied") {
    if (deletion.reason_code === "in_use") return { kind: "in-use" };
    if (deletion.reason_code === "name_mismatch") return { kind: "name-mismatch" };
    return { kind: "denied" };
  }
  if (!deletion.laundry_equipment_id) return { kind: "failed" };
  return {
    kind: deletion.already_applied ? "already-applied" : "applied",
    equipmentId: deletion.laundry_equipment_id,
  };
}

export async function renderLaundryEquipmentQrSvg(
  id: unknown,
  origin?: string,
): Promise<{ svg: string; equipmentName: string; qrVersion: number } | null> {
  await requireRole("laundry_supervisor");
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return null;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_current_laundry_equipment_qr", {
    target_laundry_equipment_id: parsed.data,
  });
  const result = qrSchema.safeParse(data);
  if (error || !result.success) return null;
  const credential = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!credential || credential.laundry_equipment_id !== parsed.data) return null;
  return {
    svg: renderFixedAssetQrSvg({
      scanPath: "/scan/equipment",
      fragmentNamespace: "equipment",
      assetId: parsed.data,
      fragmentCredential: credential.qr_token,
      label: credential.equipment_name,
      origin,
    }),
    equipmentName: credential.equipment_name,
    qrVersion: credential.qr_version,
  };
}
