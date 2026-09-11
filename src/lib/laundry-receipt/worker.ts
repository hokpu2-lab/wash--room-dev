import "server-only";

import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  qrToken: z.string().regex(/^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/),
  categoryCodes: z.array(z.string().trim().min(1).max(40)).min(1).max(30),
  requestId: z.uuid(),
});
const resultSchema = z.array(z.object({
  laundry_order_id: z.uuid().nullable(),
  batch_count: z.number().int().nonnegative(),
  already_applied: z.boolean(),
  outcome: z.enum(["applied", "denied"]),
  status: z.string().nullable(),
  reason_code: z.string(),
}));

export type LaundryReceiptResult =
  | { kind: "received" | "already-received"; orderId: string; batchCount: number; status: string }
  | { kind: "invalid" | "denied" | "failed"; reasonCode: string };

export async function receiveLaundryOrderFromCartQr(input: unknown): Promise<LaundryReceiptResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid", reasonCode: "invalid_categories" };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("receive_laundry_order_from_cart_qr", {
    qr_token: parsed.data.qrToken,
    selected_category_codes: parsed.data.categoryCodes.map((code) => code.toUpperCase()),
    change_request_id: parsed.data.requestId,
  });
  const result = resultSchema.safeParse(data);
  if (error || !result.success || result.data.length !== 1) return { kind: "failed", reasonCode: "service_unavailable" };
  const change = result.data[0];
  if (change.outcome === "denied" || !change.laundry_order_id || !change.status) return { kind: "denied", reasonCode: change.reason_code };
  return { kind: change.already_applied ? "already-received" : "received", orderId: change.laundry_order_id, batchCount: change.batch_count, status: change.status };
}
