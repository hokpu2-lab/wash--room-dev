import "server-only";

import { z } from "zod";
import { resolveOperableEquipmentToken } from "@/lib/laundry-equipment/dispatch";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const token = z.string().regex(/^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
const stageInput = z.object({
  qrToken: token.nullish(),
  equipmentId: z.uuid().nullish(),
  batchId: z.uuid(),
  requestId: z.uuid(),
});

async function resolveToken(input: z.infer<typeof stageInput>) {
  if (input.qrToken) return input.qrToken;
  if (input.equipmentId) return resolveOperableEquipmentToken(input.equipmentId);
  return null;
}
const startResult = z.array(z.object({ laundry_batch_id: z.uuid(), stage_run_id: z.uuid().nullable(), laundry_equipment_id: z.uuid().nullable(), stage_order: z.number().int().nullable(), already_applied: z.boolean(), outcome: z.enum(["applied", "denied"]), status: z.string().nullable(), reason_code: z.string() }));
const completeResult = z.array(z.object({ laundry_batch_id: z.uuid(), completed_stage_run_id: z.uuid().nullable(), laundry_equipment_id: z.uuid().nullable(), stage_order: z.number().int().nullable(), already_applied: z.boolean(), outcome: z.enum(["applied", "denied"]), status: z.string().nullable(), reason_code: z.string() }));

export async function startDisinfection(input: unknown) {
  const parsed = stageInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const, reasonCode: "invalid_request" };
  const qrToken = await resolveToken(parsed.data);
  if (!qrToken) return { kind: "invalid" as const, reasonCode: "invalid_qr" };
  const { data, error } = await (await createServerSupabaseClient({ cookieWritesRequired: true })).rpc("start_laundry_batch_disinfection_from_equipment_qr", { qr_token: qrToken, target_laundry_batch_id: parsed.data.batchId, change_request_id: parsed.data.requestId });
  const result = startResult.safeParse(data); if (error || !result.success || result.data.length !== 1) return { kind: "failed" as const, reasonCode: "service_unavailable" };
  const row = result.data[0]; if (row.outcome === "denied" || !row.stage_run_id || !row.laundry_equipment_id || !row.status || row.stage_order === null) return { kind: "denied" as const, reasonCode: row.reason_code };
  return { kind: row.already_applied ? "already-started" as const : "started" as const, batchId: row.laundry_batch_id, stageRunId: row.stage_run_id, equipmentId: row.laundry_equipment_id, status: row.status };
}

export async function completeDisinfection(input: unknown) {
  const parsed = stageInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const, reasonCode: "invalid_request" };
  const qrToken = await resolveToken(parsed.data);
  if (!qrToken) return { kind: "invalid" as const, reasonCode: "invalid_qr" };
  const { data, error } = await (await createServerSupabaseClient({ cookieWritesRequired: true })).rpc("complete_laundry_batch_stage_from_equipment_qr", { qr_token: qrToken, target_laundry_batch_id: parsed.data.batchId, change_request_id: parsed.data.requestId });
  const result = completeResult.safeParse(data); if (error || !result.success || result.data.length !== 1) return { kind: "failed" as const, reasonCode: "service_unavailable" };
  const row = result.data[0]; if (row.outcome === "denied" || !row.laundry_equipment_id || !row.status) return { kind: "denied" as const, reasonCode: row.reason_code };
  return { kind: row.already_applied ? "already-started" as const : "started" as const, batchId: row.laundry_batch_id, stageRunId: row.completed_stage_run_id, equipmentId: row.laundry_equipment_id, status: row.status };
}
