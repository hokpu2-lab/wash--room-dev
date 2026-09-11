import "server-only";

import { z } from "zod";

import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole } from "@/lib/auth/principal";
import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";
import { renderFixedAssetQrSvg } from "@/lib/fixed-asset-qr";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const namedSiteSchema = z.object({ code: z.string(), name: z.string() });
const equipmentSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  equipment_type: z.enum(["disinfection_tank", "washer", "dryer"]),
  capacity_kg: z.coerce.number().int().nullable().optional(),
  status: z.enum(["normal", "inactive", "abnormal", "maintenance"]),
  occupied: z.boolean().optional().default(false),
  current_qr_version: z.number().int().positive(),
  operating_site_id: z.uuid().optional(),
  category_codes: z.array(z.string()).optional().default([]),
  procedure_template_ids: z.array(z.uuid()).optional().default([]),
  operating_sites: z.union([namedSiteSchema, z.array(namedSiteSchema)]).transform((value) => (
    Array.isArray(value) ? value[0] ?? { code: "—", name: "—" } : value
  )),
});
const siteSchema = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

const categorySchema = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
const procedureSchema = z.object({
  id: z.uuid(),
  operating_site_id: z.uuid(),
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
  | { kind: "invalid" | "failed" | "denied" };
export type EquipmentDeletionResult =
  | { kind: "applied" | "already-applied"; equipmentId: string }
  | { kind: "invalid" | "failed" | "denied" | "in-use" | "name-mismatch" };

const registerInput = z.object({
  name: z.string().trim().min(1).max(80), siteCode: z.string().trim().min(1).max(40),
  equipmentType: z.enum(["disinfection_tank", "washer", "dryer"]), capacityKg: z.number().int().min(1).max(20).nullable(),
  categoryCodes: z.array(z.string().trim().min(1)).max(30), procedureTemplateIds: z.array(z.uuid()).max(30),
  requestId: z.uuid(), reason: z.string().trim().min(1).max(500),
});
const updateInput = z.object({
  equipmentId: z.uuid(), name: z.string().trim().min(1).max(80), capacityKg: z.number().int().min(1).max(20).nullable(),
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
  const [equipmentResult, categoryResult, procedureResult, siteResult, categoryCapResult, procedureCapResult] = await Promise.all([
    supabase.from("laundry_equipment").select("id, name, equipment_type, capacity_kg, status, occupied, current_qr_version, operating_site_id, operating_sites(code, name)").in("operating_site_id", siteIds).order("name", { ascending: true }),
    supabase.from("laundry_categories").select("id, code, name").eq("active", true).order("sort_order", { ascending: true }),
    supabase.from("procedure_templates").select("id, operating_site_id, procedure_template_versions(template_name, status)").in("operating_site_id", siteIds),
    supabase.from("operating_sites").select("id, code, name").in("id", siteIds).order("code", { ascending: true }),
    supabase.from("laundry_equipment_categories").select("laundry_equipment_id, laundry_categories(code)"),
    supabase.from("laundry_equipment_procedures").select("laundry_equipment_id, procedure_template_id"),
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
  const workspace = workspaceSchema.safeParse({
    equipment: (equipmentResult.data ?? []).map((item) => ({
      ...item,
      category_codes: categoryCaps.get(item.id) ?? [],
      procedure_template_ids: procedureCaps.get(item.id) ?? [],
    })),
    categories: categoryResult.data ?? [],
    procedures: procedureResult.data ?? [],
    sites: siteResult.data ?? [],
  });
  if (!workspace.success) {
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
  const { data, error } = await supabase.rpc("register_laundry_equipment", { requested_name: parsed.data.name.toUpperCase(), target_site_code: parsed.data.siteCode.toUpperCase(), target_equipment_type: parsed.data.equipmentType, target_capacity_kg: parsed.data.capacityKg, target_category_codes: parsed.data.categoryCodes.map((code) => code.toUpperCase()), target_procedure_template_ids: parsed.data.procedureTemplateIds, change_request_id: parsed.data.requestId, change_reason: parsed.data.reason });
  const result = changeSchema.safeParse(data); if (error || !result.success || result.data.length !== 1) return { kind: "failed" };
  const change = result.data[0]; if (change.outcome === "denied") return { kind: "denied" }; if (!change.laundry_equipment_id || change.qr_version === null) return { kind: "failed" };
  return { kind: change.already_applied ? "already-applied" : "applied", equipmentId: change.laundry_equipment_id, qrVersion: change.qr_version };
}

export async function updateLaundryEquipment(input: unknown): Promise<EquipmentChangeResult> {
  await requireRole("laundry_supervisor"); const parsed = updateInput.safeParse(input); if (!parsed.success) return { kind: "invalid" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("update_laundry_equipment", { target_laundry_equipment_id: parsed.data.equipmentId, requested_name: parsed.data.name.toUpperCase(), target_capacity_kg: parsed.data.capacityKg, target_status: parsed.data.status, target_category_codes: parsed.data.categoryCodes.map((code) => code.toUpperCase()), target_procedure_template_ids: parsed.data.procedureTemplateIds, change_request_id: parsed.data.requestId, change_reason: parsed.data.reason });
  const result = changeSchema.safeParse(data); if (error || !result.success || result.data.length !== 1) return { kind: "failed" }; const change = result.data[0]; if (change.outcome === "denied") return { kind: "denied" }; if (!change.laundry_equipment_id || change.qr_version === null) return { kind: "failed" };
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
