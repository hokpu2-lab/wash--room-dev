import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { ControlBatch } from "./batch-label";

export type { ControlBatch };
export { formatBatchLabel } from "./batch-label";

export type ControlEquipment = {
  id: string;
  name: string;
  equipment_type: string;
  operating_site_id: string;
  operating_site_name?: string;
  occupied: boolean;
  status?: string;
};

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
      "id, status, current_stage_order, operating_site_id, source_laundry_cart_id, laundry_order_id, laundry_carts!source_laundry_cart_id(cart_number), operating_sites(name), laundry_orders(order_number, laundry_cart_id, laundry_carts(cart_number), institutions(name)), laundry_categories(name)",
    )
    .in("status", statuses)
    .order("created_at", { ascending: true });
  if (scope.siteId) request = request.eq("operating_site_id", scope.siteId);
  const { data } = await request;

  // 100% 確保洗衣車號完整解析：若 batch 或 order 含有 cart_id，批量查詢 laundry_carts
  const cartIds = Array.from(
    new Set(
      (data ?? []).flatMap((item) => {
        const order = Array.isArray(item?.laundry_orders) ? item?.laundry_orders[0] : item?.laundry_orders;
        const orderCartId = order && typeof order === "object" && "laundry_cart_id" in order && typeof order.laundry_cart_id === "string" ? order.laundry_cart_id : null;
        const sourceCartId = typeof item?.source_laundry_cart_id === "string" ? item.source_laundry_cart_id : null;
        return [sourceCartId, orderCartId].filter((id): id is string => Boolean(id));
      }),
    ),
  );
  const cartMap = new Map<string, string>();
  if (cartIds.length > 0) {
    const { data: cartsData } = await supabase
      .from("laundry_carts")
      .select("id, cart_number")
      .in("id", cartIds);
    if (Array.isArray(cartsData)) {
      for (const cart of cartsData) {
        if (cart?.id && typeof cart.cart_number === "string") {
          cartMap.set(cart.id, cart.cart_number);
        }
      }
    }
  }

  let equipmentRequest = supabase
    .from("laundry_equipment")
    .select("id, name, equipment_type, operating_site_id, occupied, status, operating_sites(name)")
    .eq("status", "normal")
    .order("name", { ascending: true });
  if (scope.siteId) {
    equipmentRequest = equipmentRequest.eq("operating_site_id", scope.siteId);
  }
  const { data: equipmentData } = await equipmentRequest;

  const equipmentList: ControlEquipment[] = Array.isArray(equipmentData)
    ? equipmentData.flatMap((item) =>
        typeof item?.id === "string" && typeof item?.name === "string"
          ? [
              {
                id: item.id,
                name: item.name,
                equipment_type:
                  typeof item.equipment_type === "string" ? item.equipment_type : "washer",
                operating_site_id:
                  typeof item.operating_site_id === "string" ? item.operating_site_id : "",
                operating_site_name: named(item.operating_sites),
                occupied: Boolean(item.occupied),
                status: typeof item.status === "string" ? item.status : "normal",
              },
            ]
          : [],
      )
    : [];

  const batches = Array.isArray(data)
    ? data.flatMap((item) => {
        if (
          typeof item?.id !== "string" ||
          typeof item?.status !== "string" ||
          typeof item?.current_stage_order !== "number"
        ) {
          return [];
        }
        const orderInfo = fromOrder(item.laundry_orders);
        const order = Array.isArray(item.laundry_orders) ? item.laundry_orders[0] : item.laundry_orders;
        const orderCartId = order && typeof order === "object" && "laundry_cart_id" in order && typeof order.laundry_cart_id === "string" ? order.laundry_cart_id : null;
        const cartNumber =
          (item.source_laundry_cart_id && cartMap.get(item.source_laundry_cart_id)) ||
          (orderCartId && cartMap.get(orderCartId)) ||
          named(item.laundry_carts) ||
          orderInfo.cartNumber;
        return [
          {
            id: item.id,
            status: item.status,
            current_stage_order: item.current_stage_order,
            operating_site_id:
              typeof item.operating_site_id === "string" ? item.operating_site_id : undefined,
            operating_site_name: named(item.operating_sites),
            orderNumber: orderInfo.orderNumber,
            cartNumber: cartNumber,
            institutionName: orderInfo.institutionName,
            categoryName: named(item.laundry_categories),
          },
        ];
      })
    : [];
  return { batches, siteId: scope.siteId ?? undefined, equipmentList };
}
