import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAnyRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

const pendingOrderRowSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string().min(1),
  created_at: z.string(),
  institution_name: z.string().min(1),
  cart_id: z.string().uuid(),
  cart_number: z.string().min(1),
  qr_token: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    await requireAnyRole(["laundry_worker", "laundry_supervisor", "system_administrator"]);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: responseHeaders });
  }

  const { searchParams } = new URL(request.url);
  const siteIdParam = searchParams.get("siteId");
  const siteId = siteIdParam && z.string().uuid().safeParse(siteIdParam).success ? siteIdParam : null;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_pending_receipt_orders", {
    target_site_id: siteId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: responseHeaders });
  }

  const parsed = z.array(pendingOrderRowSchema).safeParse(data);
  if (!parsed.success) {
    return NextResponse.json({ orders: [] }, { status: 200, headers: responseHeaders });
  }

  const orders = parsed.data.map((row) => ({
    orderId: row.order_id,
    orderNumber: row.order_number,
    createdAt: row.created_at,
    institutionName: row.institution_name,
    cartId: row.cart_id,
    cartNumber: row.cart_number,
    qrToken: row.qr_token,
    receiveHref: `/app/operations/receive#v1.cart.${row.qr_token}`,
  }));

  return NextResponse.json({ orders }, { status: 200, headers: responseHeaders });
}
