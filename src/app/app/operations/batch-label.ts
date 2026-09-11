export type ControlBatch = {
  id: string;
  status: string;
  current_stage_order: number;
  orderNumber?: string;
  cartNumber?: string;
  categoryName?: string;
  institutionName?: string;
};

export function formatBatchLabel(batch: {
  id: string;
  current_stage_order: number;
  orderNumber?: string;
  cartNumber?: string;
  categoryName?: string;
  institutionName?: string;
}) {
  const parts = [
    batch.orderNumber,
    batch.cartNumber,
    batch.categoryName,
    batch.institutionName,
  ].filter(Boolean);
  const lead = parts.length > 0 ? parts.join(" · ") : `批次 ${batch.id.slice(0, 8)}`;
  return `${lead} · 第 ${batch.current_stage_order} 階段`;
}
