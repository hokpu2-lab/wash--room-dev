"use client";

import { useState } from "react";

import { useWorkspaceLive } from "./use-workspace-live";

export type LiveBatchOption = {
  id: string;
  status: string;
  current_stage_order: number;
  orderNumber?: string;
  cartNumber?: string;
  categoryName?: string;
  institutionName?: string;
  operating_site_id?: string;
  operating_site_name?: string;
};

export function useLiveBatches(
  initial: LiveBatchOption[],
  statuses: string[],
  siteId?: string,
) {
  const { snapshot, liveMode, syncedAt } = useWorkspaceLive(null, { siteId, pageSize: 40 });
  if (!snapshot) return { batches: initial, liveMode, syncedAt };
  const previous = new Map(initial.map((batch) => [batch.id, batch]));
  const liveBatches = snapshot.batches
    .filter((batch) => statuses.includes(batch.status))
    .map((batch) => {
      const prior = previous.get(batch.id);
      const order = snapshot.orders.find((o) => o.orderNumber === batch.orderNumber);
      const detail = snapshot.orderDetails.find((d) =>
        d.batches.some((b) => b.id === batch.id)
      );
      const detailOrder = detail ? snapshot.orders.find((o) => o.id === detail.orderId) : null;
      return {
        id: batch.id,
        status: batch.status,
        current_stage_order: batch.stageOrder,
        orderNumber: batch.orderNumber || prior?.orderNumber,
        cartNumber: prior?.cartNumber || order?.cartNumber || detailOrder?.cartNumber,
        categoryName: batch.categoryName || prior?.categoryName,
        institutionName: prior?.institutionName || order?.institutionName || detailOrder?.institutionName,
        operating_site_id: prior?.operating_site_id,
        operating_site_name: prior?.operating_site_name,
      };
    });

  const liveIds = new Set(liveBatches.map((b) => b.id));
  const merged = [
    ...liveBatches,
    ...initial.filter((b) => statuses.includes(b.status) && !liveIds.has(b.id)),
  ];

  return {
    batches: merged,
    liveMode,
    syncedAt,
  };
}

export function usePreferredId(ids: string[]) {
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = chosen && ids.includes(chosen) ? chosen : (ids[0] ?? "");
  return [selected, setChosen] as const;
}
