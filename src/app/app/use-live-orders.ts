"use client";

import { useWorkspaceLive } from "./use-workspace-live";

export function useLiveOrders(initial: Array<{ id: string; status: string }>, statuses: string[]) {
  const { snapshot, liveMode, syncedAt } = useWorkspaceLive(null, { pageSize: 40 });
  if (!snapshot) return { orders: initial, liveMode, syncedAt };
  return {
    orders: snapshot.orders
      .filter((order) => statuses.includes(order.status))
      .map((order) => ({ id: order.id, status: order.status, orderNumber: order.orderNumber })),
    liveMode,
    syncedAt,
  };
}
