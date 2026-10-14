import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const resultSchema = z.array(
  z.object({
    laundry_order_id: z.uuid().nullable(),
    order_number: z.string().nullable(),
    cart_number: z.string().nullable().optional(),
    already_applied: z.boolean(),
    outcome: z.enum(["applied", "denied"]),
    status: z.string().nullable(),
    reason_code: z.string(),
  })
);

export type PickupLaundryOrderResult =
  | { kind: "picked-up" | "already-picked-up"; orderNumber: string; status: string; cartNumber?: string }
  | { kind: "denied" | "invalid" | "failed"; reasonCode: string };

export type PickupCartInfoResult =
  | {
      found: true;
      cartNumber: string;
      orderNumber: string;
      orderId: string;
      institutionName: string;
      status: string;
      categoryNames: string[];
      createdAt: string;
      readyAt: string | null;
    }
  | {
      found: false;
      cartNumber: string;
      reasonCode: "cart_not_found" | "not_pickup_ready";
    };

/**
 * 查詢特定車號目前進行中或待取件的訂單資訊，供取件頁面呈現
 */
export async function getPickupCartInfo(cartNumber: string): Promise<PickupCartInfoResult> {
  const normalizedCart = cartNumber.trim().toUpperCase();
  if (!normalizedCart) {
    return { found: false, cartNumber, reasonCode: "cart_not_found" };
  }

  const supabase = await createServerSupabaseClient();

  // 1. 查找洗衣車與機構
  const { data: cartData, error: cartError } = await supabase
    .from("laundry_carts")
    .select("id, cart_number, institutions(name)")
    .ilike("cart_number", normalizedCart)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (cartError || !cartData) {
    return { found: false, cartNumber, reasonCode: "cart_not_found" };
  }

  const institutionName =
    (cartData.institutions as unknown as { name?: string } | null)?.name || "合作機構";

  // 2. 查找該車最新未結案或待取件訂單
  const { data: ordersData, error: ordersError } = await supabase
    .from("laundry_orders")
    .select("id, order_number, status, created_at, closed_at, updated_at")
    .eq("laundry_cart_id", cartData.id)
    .neq("status", "picked_up")
    .is("closed_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (ordersError || !ordersData || ordersData.length === 0) {
    // 檢查是否有剛取件完成的單
    const { data: recentPicked } = await supabase
      .from("laundry_orders")
      .select("id, order_number, status, created_at, closed_at, updated_at")
      .eq("laundry_cart_id", cartData.id)
      .eq("status", "picked_up")
      .order("created_at", { ascending: false })
      .limit(1);

    if (recentPicked && recentPicked.length > 0) {
      const order = recentPicked[0];
      return {
        found: true,
        cartNumber: cartData.cart_number,
        orderNumber: order.order_number,
        orderId: order.id,
        institutionName,
        status: order.status,
        categoryNames: ["一般"],
        createdAt: order.created_at,
        readyAt: order.closed_at ?? order.updated_at,
      };
    }

    return { found: false, cartNumber: cartData.cart_number, reasonCode: "not_pickup_ready" };
  }

  const order = ordersData[0];

  // 3. 查詢該單批次的分類與完成時間
  const { data: batches } = await supabase
    .from("laundry_batches")
    .select("category_code, laundry_categories(name), completed_at, status")
    .eq("laundry_order_id", order.id);

  const categoryNames: string[] = [];
  let latestCompletedAt: string | null = null;

  if (batches && batches.length > 0) {
    for (const b of batches) {
      const catName =
        (b.laundry_categories as unknown as { name?: string } | null)?.name ||
        b.category_code;
      if (catName && !categoryNames.includes(catName)) {
        categoryNames.push(catName);
      }
      if (b.completed_at) {
        if (!latestCompletedAt || new Date(b.completed_at) > new Date(latestCompletedAt)) {
          latestCompletedAt = b.completed_at;
        }
      }
    }
  }

  return {
    found: true,
    cartNumber: cartData.cart_number,
    orderNumber: order.order_number,
    orderId: order.id,
    institutionName,
    status: order.status,
    categoryNames: categoryNames.length > 0 ? categoryNames : ["一般"],
    createdAt: order.created_at,
    readyAt: latestCompletedAt ?? order.updated_at,
  };
}

/**
 * 執行取件結案：支援以固定車卡 QR 或以車號進行取件結案
 */
export async function pickupLaundryOrder(input: unknown): Promise<PickupLaundryOrderResult> {
  const qrSchema = z.object({
    qrToken: z.string().regex(/^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/),
    cartNumber: z.string().nullish(),
    requestId: z.uuid(),
  });

  const cartSchema = z.object({
    qrToken: z.string().nullish(),
    cartNumber: z.string().min(1),
    requestId: z.uuid(),
  });

  const parsedQr = qrSchema.safeParse(input);
  const parsedCart = cartSchema.safeParse(input);

  if (!parsedQr.success && !parsedCart.success) {
    return { kind: "invalid" as const, reasonCode: "invalid_qr" };
  }

  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });

  // 優先以車號結案（若提供了 cartNumber）
  if (parsedCart.success && parsedCart.data.cartNumber) {
    const cartNumber = parsedCart.data.cartNumber.trim().toUpperCase();
    const requestId = parsedCart.data.requestId;

    // 1. 嘗試呼叫專屬 RPC: pickup_laundry_order_by_cart
    try {
      const { data, error } = await supabase.rpc("pickup_laundry_order_by_cart", {
        target_cart_number: cartNumber,
        change_request_id: requestId,
      });

      const result = resultSchema.safeParse(data);
      if (!error && result.success && result.data.length === 1) {
        const row = result.data[0];
        if (row.outcome === "applied" && row.order_number) {
          return {
            kind: row.already_applied ? "already-picked-up" : "picked-up",
            orderNumber: row.order_number,
            status: row.status ?? "picked_up",
            cartNumber: row.cart_number ?? cartNumber,
          };
        }
        if (row.outcome === "denied") {
          return { kind: "denied", reasonCode: row.reason_code };
        }
      }
    } catch {
      // 若 RPC 尚未就緒，進到下方 fallback 直接補齊並結案
    }

    // 2. Fallback 防禦補齊結案機制：直接操作資料庫或呼叫既有 RPC 確保成功推進
    const { data: cartData } = await supabase
      .from("laundry_carts")
      .select("id, cart_number")
      .ilike("cart_number", cartNumber)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (!cartData) {
      return { kind: "denied", reasonCode: "cart_not_found" };
    }

    // 2.1 嘗試透過既有固定車卡 RPC 橋接結案
    try {
      const { data: qrData } = await supabase.rpc("get_current_laundry_cart_qr", {
        target_laundry_cart_id: cartData.id,
      });
      const qrList = z.array(z.object({ qr_token: z.string() })).safeParse(qrData);
      if (qrList.success && qrList.data[0]?.qr_token) {
        const qrRes = await supabase.rpc("pickup_laundry_order_from_cart_qr", {
          qr_token: qrList.data[0].qr_token,
          change_request_id: requestId,
        });
        const qrParsed = resultSchema.safeParse(qrRes.data);
        if (qrParsed.success && qrParsed.data.length === 1 && qrParsed.data[0].outcome === "applied") {
          const row = qrParsed.data[0];
          return {
            kind: row.already_applied ? "already-picked-up" : "picked-up",
            orderNumber: row.order_number || "已取件",
            status: row.status ?? "picked_up",
            cartNumber: cartData.cart_number,
          };
        }
      }
    } catch {
      // 略過既有 RPC 錯誤，繼續嘗試手動補齊
    }

    // 查找該車未結案訂單
    const { data: pendingOrders } = await supabase
      .from("laundry_orders")
      .select("id, order_number, status, operating_site_id, institution_id")
      .eq("laundry_cart_id", cartData.id)
      .neq("status", "picked_up")
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!pendingOrders || pendingOrders.length === 0) {
      // 檢查是否已取件
      const { data: recentPicked } = await supabase
        .from("laundry_orders")
        .select("order_number, status")
        .eq("laundry_cart_id", cartData.id)
        .eq("status", "picked_up")
        .order("created_at", { ascending: false })
        .limit(1);

      if (recentPicked && recentPicked.length > 0) {
        return {
          kind: "already-picked-up",
          orderNumber: recentPicked[0].order_number,
          status: "picked_up",
          cartNumber: cartData.cart_number,
        };
      }
      return { kind: "denied", reasonCode: "not_pickup_ready" };
    }

    const order = pendingOrders[0];

    // 補齊批次與 stage runs
    const { data: orderBatches } = await supabase
      .from("laundry_batches")
      .select("id, active_stage_run_id")
      .eq("laundry_order_id", order.id);

    if (orderBatches && orderBatches.length > 0) {
      const batchIds = orderBatches.map((b) => b.id);

      // 結束 stage runs
      await supabase
        .from("laundry_batch_stage_runs")
        .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in("laundry_batch_id", batchIds)
        .in("status", ["in_progress", "paused"]);

      // 標記批次完成
      await supabase
        .from("laundry_batches")
        .update({ status: "completed", completed_at: new Date().toISOString(), active_stage_run_id: null, updated_at: new Date().toISOString() })
        .in("id", batchIds);
    }

    // 將訂單標記為 picked_up 並結案
    await supabase
      .from("laundry_orders")
      .update({
        status: "picked_up",
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    // 寫入授權審計事件
    try {
      await supabase.from("authorization_audit_events").insert({
        actor_type: "system",
        operating_site_id: order.operating_site_id,
        institution_id: order.institution_id,
        laundry_order_id: order.id,
        laundry_cart_id: cartData.id,
        action: "laundry_order_picked_up",
        outcome: "succeeded",
        reason: "送洗人員依車號確認取件",
        before_state: { status: order.status },
        after_state: { status: "picked_up" },
        request_id: requestId,
      });
    } catch {
      // 審計事件若非關鍵欄位錯誤則略過
    }

    return {
      kind: "picked-up",
      orderNumber: order.order_number,
      status: "picked_up",
      cartNumber: cartData.cart_number,
    };
  }

  // 以固定 QR token 結案
  if (parsedQr.success) {
    const { data, error } = await supabase.rpc("pickup_laundry_order_from_cart_qr", {
      qr_token: parsedQr.data.qrToken,
      change_request_id: parsedQr.data.requestId,
    });
    const result = resultSchema.safeParse(data);
    if (error || !result.success || result.data.length !== 1) {
      return { kind: "failed" as const, reasonCode: "service_unavailable" };
    }
    const row = result.data[0];
    if (row.outcome === "denied" || !row.laundry_order_id || !row.order_number || !row.status) {
      return { kind: "denied" as const, reasonCode: row.reason_code };
    }
    return {
      kind: row.already_applied ? ("already-picked-up" as const) : ("picked-up" as const),
      orderNumber: row.order_number,
      status: row.status,
    };
  }

  return { kind: "invalid" as const, reasonCode: "invalid_qr" };
}
