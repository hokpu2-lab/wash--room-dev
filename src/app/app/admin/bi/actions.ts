"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole } from "@/lib/auth/principal";
import { getBiSampleModel } from "@/lib/analytics/bi-models";

export async function saveBiView(formData: FormData) {
  const actor = await requireRole("laundry_supervisor");
  const siteId = actor.memberships.find((m) => isLaundrySupervisorRole(m.role))?.operating_site_id;
  const sample = getBiSampleModel(String(formData.get("sample_id") ?? ""));
  const name = (sample?.name ?? String(formData.get("name") ?? "")).trim();
  const parsed = z.string().min(1).max(100).safeParse(name);
  if (!parsed.success || !siteId) redirect("/app/admin/bi?status=invalid");
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { error } = await supabase.rpc("save_laundry_bi_view", {
    view_name: name,
    view_dimensions: sample?.dimensions ?? ["status"],
    view_metrics: sample?.metrics ?? ["order_count", "batch_count", "completed_count"],
    view_filters: {},
    target_site_id: siteId,
    make_shared: formData.get("shared") === "on",
    change_request_id: randomUUID(),
  });
  redirect(`/app/admin/bi?status=${error ? "failed" : "saved"}`);
}
