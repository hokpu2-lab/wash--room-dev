"use client";

import { useState } from "react";

import {
  isBatchEligibleForEquipment,
  type OperableEquipmentType,
} from "./operations/stage-eligibility";
import { useWorkspaceLive } from "./use-workspace-live";

export type LiveBatchOption = {
  id: string;
  status: string;
  current_stage_order: number;
  orderNumber?: string;
  cartNumber?: string;
  categoryCode?: string;
  categoryName?: string;
  institutionName?: string;
  operating_site_id?: string;
  operating_site_name?: string;
  equipment_type?: string;
};

export function useLiveBatches(
  initial: LiveBatchOption[],
  statuses: string[],
  siteId?: string,
  targetEquipmentType?: OperableEquipmentType,
) {
  const { snapshot, liveMode, syncedAt } = useWorkspaceLive(null, { siteId, pageSize: 40 });
  const filteredInitial = targetEquipmentType
    ? initial.filter((b) => isBatchEligibleForEquipment(b, targetEquipmentType))
    : initial;
  if (!snapshot) return { batches: filteredInitial, liveMode, syncedAt };
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
      const detailBatch = detail?.batches.find((b) => b.id === batch.id);
      const currentStage = detailBatch?.stages.find((s) => s.stageOrder === batch.stageOrder);
      return {
        id: batch.id,
        status: batch.status,
        current_stage_order: batch.stageOrder,
        orderNumber: batch.orderNumber || prior?.orderNumber,
        cartNumber: prior?.cartNumber || order?.cartNumber || detailOrder?.cartNumber,
        categoryCode: detailBatch?.categoryCode || prior?.categoryCode,
        categoryName: batch.categoryName || detailBatch?.categoryName || prior?.categoryName,
        institutionName: prior?.institutionName || order?.institutionName || detailOrder?.institutionName,
        operating_site_id: prior?.operating_site_id,
        operating_site_name: prior?.operating_site_name,
        equipment_type: currentStage?.equipmentType || prior?.equipment_type,
      };
    });

  const liveIds = new Set(liveBatches.map((b) => b.id));
  let merged = [
    ...liveBatches,
    ...filteredInitial.filter((b) => statuses.includes(b.status) && !liveIds.has(b.id)),
  ];

  if (targetEquipmentType) {
    merged = merged.filter((b) => isBatchEligibleForEquipment(b, targetEquipmentType));
  }

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
