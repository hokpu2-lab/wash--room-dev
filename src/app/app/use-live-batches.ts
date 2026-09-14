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
  const { snapshot, liveMode, syncedAt } = useWorkspaceLive(null, { siteId, pageSize: 1 });
  if (!snapshot) return { batches: initial, liveMode, syncedAt };
  const previous = new Map(initial.map((batch) => [batch.id, batch]));
  return {
    batches: snapshot.batches
      .filter((batch) => statuses.includes(batch.status))
      .map((batch) => {
        const prior = previous.get(batch.id);
        return {
          id: batch.id,
          status: batch.status,
          current_stage_order: batch.stageOrder,
          orderNumber: batch.orderNumber || prior?.orderNumber,
          cartNumber: prior?.cartNumber,
          categoryName: batch.categoryName || prior?.categoryName,
          institutionName: prior?.institutionName,
          operating_site_id: prior?.operating_site_id,
          operating_site_name: prior?.operating_site_name,
        };
      }),
    liveMode,
    syncedAt,
  };
}

export function usePreferredId(ids: string[]) {
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = chosen && ids.includes(chosen) ? chosen : (ids[0] ?? "");
  return [selected, setChosen] as const;
}
