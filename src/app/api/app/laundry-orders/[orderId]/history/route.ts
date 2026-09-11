import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAnyRole } from "@/lib/auth/principal";
import { getLaundryOrderHistoryDetail } from "@/lib/analytics/order-history";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  await requireAnyRole(["laundry_worker", "laundry_supervisor", "institution_supervisor"]);
  const { orderId } = await params;
  const parsedOrderId = z.uuid().safeParse(orderId);
  if (!parsedOrderId.success) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: responseHeaders });
  }

  const detail = await getLaundryOrderHistoryDetail(parsedOrderId.data);
  if (!detail) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: responseHeaders });
  }

  return NextResponse.json(detail, { headers: responseHeaders });
}
