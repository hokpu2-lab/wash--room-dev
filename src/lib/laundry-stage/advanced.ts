import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const uuid = z.uuid();

export async function mergeBatches(input: unknown) {
  const parsed = z.object({ targetBatchId: uuid, sourceBatchId: uuid }).safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("merge_compatible_laundry_batches", { target_batch_id: parsed.data.targetBatchId, source_batch_id: parsed.data.sourceBatchId, change_request_id: randomUUID() });
  if (error || !Array.isArray(data) || data.length !== 1) return { kind: "failed" as const };
  return data[0];
}

export async function pauseBatch(input: unknown) {
  const parsed = z.object({ batchId: uuid, reason: z.string().trim().min(1).max(500) }).safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("pause_laundry_batch_stage", { target_laundry_batch_id: parsed.data.batchId, pause_reason: parsed.data.reason, change_request_id: randomUUID() });
  if (error || !Array.isArray(data) || data.length !== 1) return { kind: "failed" as const };
  return data[0];
}

export async function resumeBatch(input: unknown) {
  const parsed = uuid.safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("resume_laundry_batch_stage", { target_laundry_batch_id: parsed.data, change_request_id: randomUUID() });
  if (error || !Array.isArray(data) || data.length !== 1) return { kind: "failed" as const };
  return data[0];
}

export async function recordIncident(input: unknown) {
  const parsed = z.object({ batchId: uuid, type: z.string().min(1), responsibility: z.string().min(1), description: z.string().trim().min(1).max(500) }).safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("record_laundry_batch_incident", { target_laundry_batch_id: parsed.data.batchId, target_incident_type: parsed.data.type, target_responsibility: parsed.data.responsibility, incident_description: parsed.data.description, change_request_id: randomUUID() });
  if (error || !Array.isArray(data) || data.length !== 1) return { kind: "failed" as const };
  return data[0];
}

export async function createReplan(input: unknown) {
  const parsed = z.object({ siteId: uuid, reason: z.string().trim().min(1).max(500) }).safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("create_laundry_replan_suggestion", { target_site_id: parsed.data.siteId, replan_reason: parsed.data.reason, change_request_id: randomUUID() });
  if (error || !Array.isArray(data) || data.length !== 1) return { kind: "failed" as const };
  return data[0];
}

export async function reverseLastBatchOperation(input: unknown) {
  const parsed = z.object({
    batchId: uuid,
    reason: z.string().trim().min(2).max(500),
    confirmed: z.literal(true),
    requestId: uuid.optional(),
  }).safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("reverse_last_laundry_batch_operation", {
    target_laundry_batch_id: parsed.data.batchId,
    reversal_reason: parsed.data.reason,
    change_request_id: parsed.data.requestId ?? randomUUID(),
  });
  if (error || !Array.isArray(data) || data.length !== 1) return { kind: "failed" as const };
  return data[0];
}
