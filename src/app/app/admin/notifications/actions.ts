"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole } from "@/lib/auth/principal";
import { sendNotificationEmail } from "@/lib/notifications/send-email";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function saveNotificationRule(formData: FormData) {
  const principal = await requireRole("laundry_supervisor");
  const siteId = principal.memberships.find((m) => isLaundrySupervisorRole(m.role))?.operating_site_id;
  const parsed = z.object({
    ruleId: z.uuid().optional(),
    event: z.enum(["order_ready_for_pickup", "order_overdue", "batch_incident_critical", "progress_digest"]),
    channel: z.enum(["in_app", "email", "line", "telegram"]),
    role: z.enum(["laundry_supervisor", "institution_supervisor"]),
    severity: z.enum(["normal", "high", "critical"]),
    enabled: z.boolean(),
  }).safeParse({
    ruleId: String(formData.get("rule_id") ?? "") || undefined,
    event: String(formData.get("event") ?? ""),
    channel: String(formData.get("channel") ?? ""),
    role: String(formData.get("role") ?? ""),
    severity: String(formData.get("severity") ?? ""),
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
  });
  if (!parsed.success || !siteId) redirect("/app/admin/notifications?status=invalid");
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { error } = parsed.data.ruleId
    ? await supabase.rpc("update_notification_matrix_rule", {
      target_rule_id: parsed.data.ruleId,
      target_event_key: parsed.data.event,
      target_channel: parsed.data.channel,
      target_role: parsed.data.role,
      target_severity: parsed.data.severity,
      target_enabled: parsed.data.enabled,
    })
    : await supabase.rpc("upsert_notification_matrix_rule", {
      target_event_key: parsed.data.event,
      target_channel: parsed.data.channel,
      target_role: parsed.data.role,
      target_site_id: siteId,
      target_institution_id: null,
      target_severity: parsed.data.severity,
      target_enabled: parsed.data.enabled,
      target_destination: null,
      change_request_id: randomUUID(),
    });
  redirect(`/app/admin/notifications?status=${error ? "failed" : "saved"}`);
}

export async function toggleNotificationRule(formData: FormData) {
  await requireRole("laundry_supervisor");
  const parsed = z.object({
    ruleId: z.uuid(),
    enabled: z.enum(["true", "false"]),
  }).safeParse({
    ruleId: String(formData.get("rule_id") ?? ""),
    enabled: String(formData.get("enabled") ?? ""),
  });
  if (!parsed.success) redirect("/app/admin/notifications?status=invalid");
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { error } = await supabase.rpc("set_notification_matrix_rule_enabled", {
    target_rule_id: parsed.data.ruleId,
    target_enabled: parsed.data.enabled === "true",
  });
  redirect(`/app/admin/notifications?status=${error ? "failed" : "saved"}`);
}

export async function saveDestination(formData: FormData) {
  const principal = await requireRole("laundry_supervisor");
  const siteId = principal.memberships.find((m) => isLaundrySupervisorRole(m.role))?.operating_site_id;
  const parsed = z.object({
    type: z.enum(["line", "telegram", "email"]),
    label: z.string().trim().min(1).max(80),
    destination: z.string().trim().min(1).max(200),
  }).safeParse({
    type: String(formData.get("type") ?? ""),
    label: String(formData.get("label") ?? ""),
    destination: String(formData.get("destination") ?? ""),
  });
  if (!parsed.success || !siteId) redirect("/app/admin/notifications?status=invalid");
  const destination = parsed.data.type === "email"
    ? parsed.data.destination.toLowerCase()
    : parsed.data.destination;
  if (parsed.data.type === "email" && !z.email().safeParse(destination).success) {
    redirect("/app/admin/notifications?status=invalid");
  }
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { error } = await supabase.rpc("upsert_notification_external_destination", {
    destination_type: parsed.data.type,
    destination_label: parsed.data.label,
    destination_value: destination,
    target_site_id: siteId,
    target_institution_id: null,
    target_active: true,
    change_request_id: randomUUID(),
  });
  redirect(`/app/admin/notifications?status=${error ? "failed" : "destination-saved"}`);
}

export async function testEmailDestination(formData: FormData) {
  const principal = await requireRole("laundry_supervisor");
  const siteId = principal.memberships.find((m) => isLaundrySupervisorRole(m.role))?.operating_site_id;
  const destinationId = String(formData.get("destination_id") ?? "");
  if (!siteId || !z.uuid().safeParse(destinationId).success) {
    redirect("/app/admin/notifications?status=invalid");
  }
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("test_notification_external_destination", {
    target_destination_id: destinationId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || row.outcome === "denied") {
    redirect("/app/admin/notifications?status=failed");
  }
  if (row.destination_type !== "email") {
    redirect(`/app/admin/notifications?status=${row.reason_code === "not_configured" ? "email-unconfigured" : "destination-saved"}`);
  }
  const { data: destination } = await supabase
    .from("notification_external_destinations")
    .select("destination")
    .eq("id", destinationId)
    .maybeSingle();
  if (!destination?.destination) redirect("/app/admin/notifications?status=failed");
  const sent = await sendNotificationEmail({
    to: destination.destination,
    subject: "清福洗衣通知測試",
    text: "這是通知矩陣的 Email 測試信件。",
  });
  redirect(`/app/admin/notifications?status=${sent.ok ? "destination-saved" : sent.reason === "not_configured" ? "email-unconfigured" : "failed"}`);
}
