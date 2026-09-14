import "server-only";

import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const token = z.string().regex(/^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
const dispatchSchema = z.object({
  outcome: z.enum(["ok", "denied"]),
  reason_code: z.string().optional(),
  next_path: z.string().optional(),
  equipment_type: z.string().optional(),
  laundry_equipment_id: z.uuid().optional(),
  operating_site_id: z.uuid().optional(),
  occupied: z.boolean().optional(),
});
const operableSchema = z.array(
  z.object({
    laundry_equipment_id: z.uuid(),
    qr_token: z.string(),
    operating_site_id: z.uuid(),
    occupied: z.boolean(),
    equipment_type: z.string(),
  }),
);
const activeRunSchema = z.array(z.object({ laundry_batch_id: z.uuid() }));

export async function resolveOperableEquipmentToken(equipmentId: string) {
  const parsed = z.uuid().safeParse(equipmentId);
  if (!parsed.success) return null;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_operable_laundry_equipment_qr", {
    target_laundry_equipment_id: parsed.data,
  });
  const result = operableSchema.safeParse(data);
  if (error || !result.success || !result.data[0]?.qr_token) return null;
  return result.data[0].qr_token;
}

export async function dispatchEquipmentQr(input: unknown) {
  const parsed = z
    .object({
      qrToken: token.nullish(),
      equipmentId: z.uuid().nullish(),
    })
    .safeParse(input);
  if (!parsed.success || (!parsed.data.qrToken && !parsed.data.equipmentId)) {
    return { kind: "invalid" as const, reasonCode: "invalid_qr" };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = parsed.data.equipmentId
    ? await supabase.rpc("dispatch_laundry_equipment_by_id", {
        target_laundry_equipment_id: parsed.data.equipmentId,
      })
    : await supabase.rpc("dispatch_laundry_equipment_qr", {
        qr_token: parsed.data.qrToken,
      });
  const result = dispatchSchema.safeParse(data);
  if (error || !result.success) return { kind: "failed" as const, reasonCode: "service_unavailable" };
  if (result.data.outcome === "denied" || !result.data.next_path) {
    return { kind: "denied" as const, reasonCode: result.data.reason_code ?? "invalid_qr" };
  }
  let batchId: string | undefined;
  if (result.data.occupied && result.data.laundry_equipment_id) {
    const runs = await supabase
      .from("laundry_batch_stage_runs")
      .select("laundry_batch_id")
      .eq("laundry_equipment_id", result.data.laundry_equipment_id)
      .eq("status", "in_progress")
      .limit(1);
    const active = activeRunSchema.safeParse(runs.data);
    batchId = active.success ? active.data[0]?.laundry_batch_id : undefined;
  }
  const params = new URLSearchParams();
  if (result.data.operating_site_id) params.set("site", result.data.operating_site_id);
  if (result.data.laundry_equipment_id) params.set("e", result.data.laundry_equipment_id);
  params.set("mode", batchId ? "complete" : "start");
  if (batchId) params.set("batch", batchId);
  let equipmentName: string | undefined;
  let operatingSiteName: string | undefined;
  let operatingSiteCode: string | undefined;
  if (result.data.laundry_equipment_id) {
    const { data: machine } = await supabase
      .from("laundry_equipment")
      .select("name, operating_sites(id, name, code)")
      .eq("id", result.data.laundry_equipment_id)
      .maybeSingle();
    if (machine) {
      equipmentName = machine.name;
      const site = machine.operating_sites as unknown as { id: string; name: string; code: string } | null;
      operatingSiteName = site?.name;
      operatingSiteCode = site?.code;
    }
  }
  return {
    kind: "dispatch" as const,
    href: `${result.data.next_path}?${params.toString()}`,
    equipmentType: result.data.equipment_type ?? "washer",
    equipmentId: result.data.laundry_equipment_id,
    equipmentName,
    operatingSiteId: result.data.operating_site_id,
    operatingSiteName,
    operatingSiteCode,
  };
}
