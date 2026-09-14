import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { ControlBatch } from "./batch-label";

export type { ControlBatch };
export { formatBatchLabel } from "./batch-label";

function named(value: unknown): string | undefined {
  if (!value) return undefined;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return undefined;
  if ("name" in row && typeof row.name === "string" && row.name) return row.name;
  if ("cart_number" in row && typeof row.cart_number === "string" && row.cart_number) {
    return row.cart_number;
  }
  if ("order_number" in row && typeof row.order_number === "string" && row.order_number) {
    return row.order_number;
  }
  return undefined;
}

function fromOrder(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return {};
  return {
    orderNumber: named(row),
    cartNumber: "laundry_carts" in row ? named(row.laundry_carts) : undefined,
    institutionName: "institutions" in row ? named(row.institutions) : undefined,
  };
}

export async function loadSiteBatches(
  query: Record<string, string | string[] | undefined>,
  statuses: string[],
) {
  const scope = await resolveWorkspaceScope(query);
  const supabase = await createServerSupabaseClient();
  let request = supabase
    .from("laundry_batches")
    .select(
      "id, status, current_stage_order, operating_site_id, operating_sites(name), laundry_orders(order_number, laundry_carts(cart_number), institutions(name)), laundry_categories(name)",
    )
    .in("status", statuses)
    .order("created_at", { ascending: true });
  if (scope.siteId) request = request.eq("operating_site_id", scope.siteId);
  const { data } = await request;
  const batches = Array.isArray(data)
    ? data.flatMap((item) =>
        typeof item?.id === "string" &&
        typeof item?.status === "string" &&
        typeof item?.current_stage_order === "number"
          ? [
              {
                id: item.id,
                status: item.status,
                current_stage_order: item.current_stage_order,
                operating_site_id: typeof item.operating_site_id === "string" ? item.operating_site_id : undefined,
                operating_site_name: named(item.operating_sites),
                ...fromOrder(item.laundry_orders),
                categoryName: named(item.laundry_categories),
              },
            ]
          : [],
      )
    : [];
  return { batches, siteId: scope.siteId ?? undefined };
}
