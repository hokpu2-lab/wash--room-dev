import "server-only";

import { z } from "zod";

import { getPrincipalState } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const token = z.string().regex(/^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
const dispatchSchema = z.object({
  outcome: z.enum(["ok", "denied"]),
  reason_code: z.string().optional(),
  next_path: z.string().optional(),
  mode: z.string().optional(),
});

export async function dispatchCartQr(input: unknown) {
  const parsed = z.object({ qrToken: token }).safeParse(input);
  if (!parsed.success) return { kind: "invalid" as const, reasonCode: "invalid_qr" };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("dispatch_laundry_cart_qr", {
    qr_token: parsed.data.qrToken,
  });
  const result = dispatchSchema.safeParse(data);
  if (error || !result.success) return { kind: "failed" as const, reasonCode: "service_unavailable" };
  if (result.data.outcome === "denied" || !result.data.next_path) {
    return { kind: "denied" as const, reasonCode: result.data.reason_code ?? "invalid_qr" };
  }
  const principal = await getPrincipalState();
  return {
    kind: "dispatch" as const,
    href: result.data.next_path,
    mode: result.data.mode ?? "workspace",
    signedIn: principal.kind === "authorized",
  };
}
