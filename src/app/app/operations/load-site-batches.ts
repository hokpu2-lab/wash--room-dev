import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { ControlBatch } from "./batch-label";
import {
  isBatchEligibleForEquipment,
  type OperableEquipmentType,
} from "./stage-eligibility";

export type { ControlBatch, OperableEquipmentType };
export { formatBatchLabel } from "./batch-label";
export { isBatchEligibleForEquipment, resolveRequiredEquipmentForBatch } from "./stage-eligibility";

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

function coded(value: unknown): string | undefined {
  if (!value) return undefined;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return undefined;
  if ("code" in row && typeof row.code === "string" && row.code) return row.code;
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
  targetEquipmentType?: OperableEquipmentType,
) {
  const scope = await resolveWorkspaceScope(query);
  const supabase = await createServerSupabaseClient();
  let request = supabase
    .from("laundry_batches")
    .select(
      "id, status, current_stage_order, procedure_version_id, operating_site_id, source_laundry_cart_id, laundry_order_id, laundry_carts!source_laundry_cart_id(cart_number), operating_sites(name), laundry_orders(order_number, laundry_cart_id, laundry_carts(cart_number), institutions(name)), laundry_categories(id, code, name)",
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

  // 查詢各批次所屬程序版本與階段對應之 equipment_type
  const versionIds = Array.from(
    new Set(
      (data ?? [])
        .map((item) => (typeof item?.procedure_version_id === "string" ? item.procedure_version_id : null))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const stageEquipmentMap = new Map<string, string>();
  if (versionIds.length > 0) {
    const { data: stagesData } = await supabase
      .from("procedure_template_stages")
      .select("procedure_version_id, stage_order, equipment_type")
      .in("procedure_version_id", versionIds);
    if (Array.isArray(stagesData)) {
      for (const stage of stagesData) {
        if (
          stage?.procedure_version_id &&
          typeof stage.stage_order === "number" &&
          typeof stage.equipment_type === "string"
        ) {
          stageEquipmentMap.set(
            `${stage.procedure_version_id}_${stage.stage_order}`,
            stage.equipment_type,
          );
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
        const stageEquipment =
          typeof item.procedure_version_id === "string"
            ? stageEquipmentMap.get(`${item.procedure_version_id}_${item.current_stage_order}`)
            : undefined;
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
            categoryCode: coded(item.laundry_categories),
            categoryName: named(item.laundry_categories),
            equipment_type: stageEquipment,
          },
        ];
      })
    : [];

  const filteredBatches = targetEquipmentType
    ? batches.filter((b) => isBatchEligibleForEquipment(b, targetEquipmentType))
    : batches;

  return { batches: filteredBatches, siteId: scope.siteId ?? undefined, equipmentList };
}
