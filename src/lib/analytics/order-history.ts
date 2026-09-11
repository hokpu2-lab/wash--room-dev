import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  parseLaundryOrderHistory,
  parseLaundryOrderHistoryDetail,
  type LaundryOrderHistoryInput,
} from "./order-history-model";

export type {
  LaundryOrderHistory,
  LaundryOrderHistoryDetail,
  LaundryOrderHistoryInput,
} from "./order-history-model";

export async function getLaundryOrderHistory(input: LaundryOrderHistoryInput) {
  const supabase = await createServerSupabaseClient();
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 40);
  const page = Math.max(input.page ?? 1, 1);
  const { data, error } = await supabase.rpc("search_laundry_order_history", {
    target_site_id: input.siteId ?? null,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    order_query: input.query?.trim() || null,
    target_institution_id: input.institutionId ?? null,
    order_limit: pageSize,
    order_offset: (page - 1) * pageSize,
  });

  if (error) return null;
  return parseLaundryOrderHistory(data, { query: input.query, page, pageSize });
}

export async function getLaundryOrderHistoryDetail(orderId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_laundry_order_history_detail", {
    target_laundry_order_id: orderId,
  });

  if (error) return null;
  return parseLaundryOrderHistoryDetail(data);
}
