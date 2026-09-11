import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAnyRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers });
  }
  const supabase = await createServerSupabaseClient();
  const principal = await requireAnyRole(["laundry_worker", "laundry_supervisor", "institution_supervisor"]);
  const { data, error } = await supabase
    .from("notification_outbox")
    .select("id, event_key, channel, severity, content_summary, status, created_at, destination, source_event_id")
    .eq("id", parsed.data)
    .eq("channel", "in_app")
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers });
  }
  const roles = principal.memberships.map((membership) => membership.role);
  return NextResponse.json({
    ...data,
    href: data.event_key === "progress_digest"
      ? (roles.includes("laundry_supervisor") ? "/app/admin" : "/app")
      : data.event_key === "batch_incident_critical"
        ? (roles.includes("laundry_supervisor") ? "/app/operations/control-center" : "/app")
        : data.source_event_id
          ? (roles.includes("laundry_supervisor")
            ? `/app/dashboard?order=${data.source_event_id}`
            : roles.includes("institution_supervisor")
              ? `/app/institution?order=${data.source_event_id}`
              : `/app?order=${data.source_event_id}`)
          : "/app/dashboard",
    action_label: data.event_key === "batch_incident_critical"
      ? "前往控制中心"
      : data.event_key === "progress_digest"
        ? "開啟戰情室"
        : "查看洗衣單",
  }, { headers });
}
