import { NextResponse } from "next/server";

import { requireAnyRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  const principal = await requireAnyRole(["laundry_worker", "laundry_supervisor", "institution_supervisor"]);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notification_outbox")
    .select("id, event_key, channel, severity, content_summary, status, created_at, source_event_id")
    .eq("channel", "in_app")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ error: "failed" }, { status: 500, headers });
  }
  const roles = principal.memberships.map((membership) => membership.role);
  const items = (data ?? []).map((item) => ({
    ...item,
    href: notificationActionHref(item.event_key, item.source_event_id, roles),
    action_label: notificationActionLabel(item.event_key),
  }));
  return NextResponse.json({ items }, { headers });
}

function notificationActionLabel(eventKey: string) {
  if (eventKey === "batch_incident_critical") return "前往控制中心";
  if (eventKey === "progress_digest") return "開啟戰情室";
  return "查看洗衣單";
}

function notificationActionHref(eventKey: string, sourceId: string | null, roles: string[]) {
  const supervisor = roles.includes("laundry_supervisor");
  const institution = roles.includes("institution_supervisor");
  if (eventKey === "progress_digest") return supervisor ? "/app/admin" : "/app";
  if (eventKey === "batch_incident_critical") return supervisor ? "/app/operations/control-center" : "/app";
  if (sourceId && (eventKey === "order_ready_for_pickup" || eventKey === "order_overdue")) {
    if (supervisor) return `/app/dashboard?order=${sourceId}`;
    if (institution) return `/app/institution?order=${sourceId}`;
    return `/app?order=${sourceId}`;
  }
  if (supervisor) return "/app/dashboard";
  if (institution) return "/app/institution";
  return "/app";
}
