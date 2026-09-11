import { NextResponse } from "next/server";
import { z } from "zod";

import { getWorkspaceOrderDetail } from "@/lib/analytics/workspace";
import { requireAnyRole } from "@/lib/auth/principal";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  await requireAnyRole(["laundry_worker", "laundry_supervisor", "institution_supervisor"]);
  const { orderId } = await params;
  const parsed = z.uuid().safeParse(orderId);
  if (!parsed.success) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers });
  }
  const detail = await getWorkspaceOrderDetail(parsed.data);
  if (!detail) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers });
  }
  return NextResponse.json(detail, { headers });
}
