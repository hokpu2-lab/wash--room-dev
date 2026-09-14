export type ControlBatch = {
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

export function formatBatchLabel(batch: {
  id: string;
  current_stage_order: number;
  orderNumber?: string;
  cartNumber?: string;
  categoryName?: string;
  institutionName?: string;
  operating_site_name?: string;
}) {
  const parts = [
    batch.orderNumber,
    batch.cartNumber,
    batch.categoryName,
    batch.institutionName,
    batch.operating_site_name ? `(${batch.operating_site_name})` : undefined,
  ].filter(Boolean);
  const lead = parts.length > 0 ? parts.join(" · ") : `批次 ${batch.id.slice(0, 8)}`;
  return `${lead} · 第 ${batch.current_stage_order} 階段`;
}
