import { z } from "zod";

export type BiDimension = "status" | "category" | "operating_site";
export type BiMetric = "order_count" | "batch_count" | "completed_count";

export type BiSampleModel = {
  id: string;
  name: string;
  kicker: string;
  description: string;
  decision: string;
  dimensions: BiDimension[];
  metrics: BiMetric[];
};

export type BiLayoutPreview = "command" | "workload" | "comparison" | "readiness";

export type BiLayoutExample = {
  id: string;
  name: string;
  kicker: string;
  description: string;
  decision: string;
  modelId: BiSampleModel["id"];
  preview: BiLayoutPreview;
  blocks: readonly string[];
};

export const biDimensionLabels: Record<BiDimension, string> = {
  status: "洗衣單狀態",
  category: "洗滌分類",
  operating_site: "作業據點",
};

export const biMetricLabels: Record<BiMetric, string> = {
  order_count: "洗衣單數",
  batch_count: "批次數",
  completed_count: "完成批次",
};

export const biSampleModels: readonly BiSampleModel[] = [
  {
    id: "flow-health",
    name: "流程健康度",
    kicker: "FLOW HEALTH",
    description: "用洗衣單狀態看出待收件、處理中與待取件的佇列比例。",
    decision: "今天要先清哪一段瓶頸？",
    dimensions: ["status"],
    metrics: ["order_count", "batch_count", "completed_count"],
  },
  {
    id: "category-throughput",
    name: "分類工作量",
    kicker: "CATEGORY LOAD",
    description: "比較各洗滌分類的洗衣單、批次與完成批次，協助安排班別與設備。",
    decision: "哪一類工作量正在堆積？",
    dimensions: ["category"],
    metrics: ["order_count", "batch_count", "completed_count"],
  },
  {
    id: "site-capacity",
    name: "據點產能比較",
    kicker: "SITE CAPACITY",
    description: "以作業據點切分處理量與完成量，適合主管檢視跨據點負載。",
    decision: "哪個據點需要重新分配資源？",
    dimensions: ["operating_site"],
    metrics: ["order_count", "batch_count", "completed_count"],
  },
  {
    id: "pickup-readiness",
    name: "取件準備度",
    kicker: "PICKUP READINESS",
    description: "聚焦待取件與已取件狀態，讓主管掌握交付是否順利收尾。",
    decision: "哪些洗衣單已完成但仍未被領回？",
    dimensions: ["status"],
    metrics: ["order_count", "completed_count"],
  },
];

export const biLayoutExamples: readonly BiLayoutExample[] = [
  {
    id: "operations-command",
    name: "營運戰情總覽",
    kicker: "COMMAND VIEW",
    description: "一頁先看核心 KPI，再往下看流程分佈與需要介入的優先佇列。",
    decision: "今天先處理哪一段瓶頸？",
    modelId: "flow-health",
    preview: "command",
    blocks: ["KPI 摘要", "流程分佈", "優先佇列"],
  },
  {
    id: "workload-capacity",
    name: "分類工作量與產能",
    kicker: "THROUGHPUT",
    description: "左側比較分類量體，右側補上批次完成量與設備／班別的處理重點。",
    decision: "哪一類工作正在堆積？",
    modelId: "category-throughput",
    preview: "workload",
    blocks: ["分類比較", "完成批次", "明細表"],
  },
  {
    id: "site-comparison",
    name: "據點比較報表",
    kicker: "SITE BENCHMARK",
    description: "用同一組 KPI 對照作業據點，先看差異排行，再回到授權範圍內的明細。",
    decision: "哪個據點需要重新分配資源？",
    modelId: "site-capacity",
    preview: "comparison",
    blocks: ["據點 KPI", "差異排行", "範圍說明"],
  },
  {
    id: "pickup-readiness",
    name: "取件準備追蹤",
    kicker: "HANDOFF READINESS",
    description: "把已完成、待取件與已取件放在同一條交付流程上，搭配例外提醒。",
    decision: "哪些洗衣單已完成但還沒收尾？",
    modelId: "pickup-readiness",
    preview: "readiness",
    blocks: ["交付摘要", "準備度", "例外提醒"],
  },
];

export function getBiSampleModel(id: string) {
  return biSampleModels.find((model) => model.id === id) ?? null;
}

export const biRunResultSchema = z.object({
  outcome: z.literal("ok"),
  view_id: z.uuid(),
  site_id: z.uuid(),
  dimensions: z.array(z.enum(["status", "category", "operating_site"])),
  metrics: z.array(z.enum(["order_count", "batch_count", "completed_count"])),
  rows: z.array(z.object({
    label: z.string(),
    order_count: z.number().nullable(),
    batch_count: z.number().nullable(),
    completed_count: z.number().nullable(),
  })),
});

export type BiRunResult = z.infer<typeof biRunResultSchema>;

export function parseBiRunResult(value: unknown): BiRunResult | null {
  const parsed = biRunResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
