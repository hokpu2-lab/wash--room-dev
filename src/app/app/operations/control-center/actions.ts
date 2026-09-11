"use server";

import { redirect } from "next/navigation";

import { createReplan, mergeBatches, pauseBatch, recordIncident, resumeBatch, reverseLastBatchOperation } from "@/lib/laundry-stage/advanced";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function mergeAction(formData: FormData) { const result = await mergeBatches({ targetBatchId: text(formData, "target"), sourceBatchId: text(formData, "source") }); redirect(`/app/operations/control-center?status=${result.kind ?? "applied"}`); }
export async function pauseAction(formData: FormData) { const result = await pauseBatch({ batchId: text(formData, "batch"), reason: text(formData, "reason") }); redirect(`/app/operations/control-center?status=${result.kind ?? "paused"}`); }
export async function resumeAction(formData: FormData) { const result = await resumeBatch(text(formData, "batch")); redirect(`/app/operations/control-center?status=${result.kind ?? "resumed"}`); }
export async function incidentAction(formData: FormData) { const result = await recordIncident({ batchId: text(formData, "batch"), type: text(formData, "type"), responsibility: text(formData, "responsibility"), description: text(formData, "description") }); redirect(`/app/operations/control-center?status=${result.kind ?? "recorded"}`); }
export async function replanAction(formData: FormData) { const result = await createReplan({ siteId: text(formData, "site"), reason: text(formData, "reason") }); redirect(`/app/operations/control-center?status=${result.kind ?? "proposed"}`); }
export async function reverseLastOperationAction(formData: FormData) {
  const result = await reverseLastBatchOperation({
    batchId: text(formData, "batch"),
    reason: text(formData, "reason"),
    confirmed: text(formData, "confirmed") === "yes",
    requestId: text(formData, "request") || undefined,
  });
  const status = "kind" in result ? result.kind : result.reason_code;
  redirect(`/app/operations/control-center?status=${encodeURIComponent(status ?? "failed")}`);
}
