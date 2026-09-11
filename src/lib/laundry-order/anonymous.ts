import "server-only";

import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  qrToken: z.string().regex(/^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/),
  requestId: z.uuid(),
});

const resultSchema = z.array(z.object({
  laundry_order_id: z.uuid().nullable(),
  order_number: z.string().nullable(),
  status: z.string().nullable(),
  already_applied: z.boolean(),
  outcome: z.enum(["applied", "denied"]),
  reason_code: z.string(),
}));

export type AnonymousLaundryOrderResult =
  | { kind: "created" | "already-created"; orderId: string; orderNumber: string; status: string }
  | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

export async function createLaundryOrderFromCartQr(input: unknown): Promise<AnonymousLaundryOrderResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid", reasonCode: "invalid_qr" };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_laundry_order_from_cart_qr", {
    qr_token: parsed.data.qrToken,
    change_request_id: parsed.data.requestId,
  });
  const result = resultSchema.safeParse(data);
  if (error || !result.success || result.data.length !== 1) return { kind: "failed", reasonCode: "service_unavailable" };
  const change = result.data[0];
  if (change.outcome === "denied" || !change.laundry_order_id || !change.order_number || !change.status) {
    return { kind: "denied", reasonCode: change.reason_code };
  }
  return {
    kind: change.already_applied ? "already-created" : "created",
    orderId: change.laundry_order_id,
    orderNumber: change.order_number,
    status: change.status,
  };
}
