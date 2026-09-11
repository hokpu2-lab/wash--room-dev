import "server-only";

import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import { resolveOperableEquipmentToken } from "@/lib/laundry-equipment/dispatch";

const inputSchema = z.object({
  qrToken: z.string().regex(/^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/).nullish(),
  equipmentId: z.uuid().nullish(),
  batchId: z.uuid(),
  requestId: z.uuid(),
});

async function resolveStageToken(input: z.infer<typeof inputSchema>) {
  if (input.qrToken) return input.qrToken;
  if (input.equipmentId) return resolveOperableEquipmentToken(input.equipmentId);
  return null;
}
const resultSchema = z.array(z.object({
  laundry_batch_id: z.uuid(),
  stage_run_id: z.uuid().nullable(),
  laundry_equipment_id: z.uuid().nullable(),
  stage_order: z.number().int().nullable(),
  already_applied: z.boolean(),
  outcome: z.enum(["applied", "denied"]),
  status: z.string().nullable(),
  reason_code: z.string(),
}));

export type LaundryWashingResult =
  | { kind: "started" | "already-started"; batchId: string; stageRunId: string; equipmentId: string; stageOrder: number; status: string }
  | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

export async function startLaundryBatchDrying(input: unknown): Promise<LaundryWashingResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid", reasonCode: "invalid_request" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const qrToken = await resolveStageToken(parsed.data);
  if (!qrToken) return { kind: "invalid", reasonCode: "invalid_qr" };
  const { data, error } = await supabase.rpc("start_laundry_batch_drying_from_equipment_qr", {
    qr_token: qrToken,
    target_laundry_batch_id: parsed.data.batchId,
    change_request_id: parsed.data.requestId,
  });
  const result = resultSchema.safeParse(data);
  if (error || !result.success || result.data.length !== 1) return { kind: "failed", reasonCode: "service_unavailable" };
  const change = result.data[0];
  if (change.outcome === "denied" || !change.stage_run_id || !change.laundry_equipment_id || !change.status || change.stage_order === null) {
    return { kind: "denied", reasonCode: change.reason_code };
  }
  return {
    kind: change.already_applied ? "already-started" : "started",
    batchId: change.laundry_batch_id,
    stageRunId: change.stage_run_id,
    equipmentId: change.laundry_equipment_id,
    stageOrder: change.stage_order,
    status: change.status,
  };
}

const completeSchema = z.array(z.object({
  laundry_batch_id: z.uuid(),
  completed_stage_run_id: z.uuid().nullable(),
  laundry_equipment_id: z.uuid().nullable(),
  stage_order: z.number().int().nullable(),
  already_applied: z.boolean(),
  outcome: z.enum(["applied", "denied"]),
  status: z.string().nullable(),
  reason_code: z.string(),
}));

export async function completeLaundryBatchStage(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const, reasonCode: "invalid_request" };
  const qrToken = await resolveStageToken(parsed.data);
  if (!qrToken) return { kind: "invalid" as const, reasonCode: "invalid_qr" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("complete_laundry_batch_stage_from_equipment_qr", {
    qr_token: qrToken,
    target_laundry_batch_id: parsed.data.batchId,
    change_request_id: parsed.data.requestId,
  });
  const result = completeSchema.safeParse(data);
  if (error || !result.success || result.data.length !== 1) return { kind: "failed" as const, reasonCode: "service_unavailable" };
  const change = result.data[0];
  if (change.outcome === "denied") return { kind: "denied" as const, reasonCode: change.reason_code };
  return {
    kind: change.already_applied ? "already-started" as const : "started" as const,
    batchId: change.laundry_batch_id,
    status: change.status ?? "not_started",
    reasonCode: change.reason_code,
  };
}

export async function startLaundryBatchWashing(input: unknown): Promise<LaundryWashingResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid", reasonCode: "invalid_request" };
  const qrToken = await resolveStageToken(parsed.data);
  if (!qrToken) return { kind: "invalid", reasonCode: "invalid_qr" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("start_laundry_batch_washing_from_equipment_qr", {
    qr_token: qrToken,
    target_laundry_batch_id: parsed.data.batchId,
    change_request_id: parsed.data.requestId,
  });
  const result = resultSchema.safeParse(data);
  if (error || !result.success || result.data.length !== 1) return { kind: "failed", reasonCode: "service_unavailable" };
  const change = result.data[0];
  if (change.outcome === "denied" || !change.stage_run_id || !change.laundry_equipment_id || !change.status || change.stage_order === null) {
    return { kind: "denied", reasonCode: change.reason_code };
  }
  return {
    kind: change.already_applied ? "already-started" : "started",
    batchId: change.laundry_batch_id,
    stageRunId: change.stage_run_id,
    equipmentId: change.laundry_equipment_id,
    stageOrder: change.stage_order,
    status: change.status,
  };
}
