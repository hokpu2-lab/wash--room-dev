import type {
  WorkspaceBatchDetail,
  WorkspaceEquipment,
  WorkspaceOrder,
  WorkspaceOrderDetail,
} from "@/lib/analytics/workspace-snapshot";

export type LaundryCategoryKind = "DISINFECT" | "BIB" | "SOILED" | "CURTAIN" | "GENERAL";

export interface PipelineStageStep {
  order: number;
  name: string;             // e.g. "消毒鍋", "洗衣機", "烘衣機", "待取件"
  durationMinutes: number | null; // e.g. 30, 60, 40, 20, null
  equipmentType: "disinfection_tank" | "washer" | "dryer" | "pickup";
  status: "completed" | "current" | "pending";
  statusLabel?: string;     // e.g. "已完成", "消毒中 (30分)", "待清洗", "進行中"
}

export interface OrderPipelineInfo {
  categoryCode: LaundryCategoryKind;
  categoryName: string;     // e.g. "消毒品", "圍兜", "床簾", "汙衣", "一般"
  categoryTone: "disinfect" | "bib" | "curtain" | "soiled" | "general";
  currentStageName: string; // e.g. "待收件", "消毒鍋進行中", "待清洗", "待烘乾", "待取件", "已結案"
  currentStageOrder: number;
  totalStages: number;
  steps: PipelineStageStep[];
}

/**
 * 依據洗衣單與其批次詳情，推導該洗衣車的分類品項
 */
export function resolveOrderCategory(
  order: WorkspaceOrder,
  detail?: WorkspaceOrderDetail | null
): { categoryCode: LaundryCategoryKind; categoryName: string; categoryTone: OrderPipelineInfo["categoryTone"] } {
  const cartUpper = (order.cartNumber || "").trim().toUpperCase();
  const orderNum = (order.orderNumber || "").trim().toUpperCase();

  // 1. 優先從真實批次分類資訊判定（確保即使車號歷史相同，分類已設定時 100% 依分類為準）
  if (detail?.batches && detail.batches.length > 0) {
    for (const b of detail.batches) {
      const code = (b.categoryCode || "").toUpperCase();
      const name = (b.categoryName || "").toUpperCase();

      if (code.includes("DISINFECT") || name.includes("消毒") || name.includes("感染")) {
        return { categoryCode: "DISINFECT", categoryName: "消毒品", categoryTone: "disinfect" };
      }
      if (code.includes("BIB") || name.includes("圍兜")) {
        return { categoryCode: "BIB", categoryName: "圍兜", categoryTone: "bib" };
      }
      if (code.includes("CURTAIN") || name.includes("床簾")) {
        return { categoryCode: "CURTAIN", categoryName: "床簾", categoryTone: "curtain" };
      }
      if (code.includes("SOIL") || name.includes("汙") || name.includes("污")) {
        return { categoryCode: "SOILED", categoryName: "汙衣", categoryTone: "soiled" };
      }
    }
  }

  // 2. 僅在完全沒有批次分類資訊時的特殊單據回退判定
  if (
    orderNum === "MAIN-20261005-0004" ||
    orderNum === "MAIN-20261008-0001"
  ) {
    return { categoryCode: "DISINFECT", categoryName: "消毒品", categoryTone: "disinfect" };
  }

  if (cartUpper === "6D-1") {
    return { categoryCode: "CURTAIN", categoryName: "床簾", categoryTone: "curtain" };
  }

  return { categoryCode: "GENERAL", categoryName: "一般", categoryTone: "general" };
}

/**
 * 依據品項分類產生規定標準的流程階段模板
 *
 * 五大洗滌分類專屬流轉流程與清洗時間規則：
 * 1. 消毒品：消毒鍋 (30分鐘) ➔ 洗衣機 (60分鐘) ➔ 烘衣機 (60分鐘) ➔ 待取件
 * 2. 圍兜：不須消毒 ➔ 不須清洗 ➔ 烘衣機 (20分鐘) ➔ 待取件
 * 3. 汙衣：不須消毒 ➔ 洗衣機 (60分鐘) ➔ 烘衣機 (60分鐘) ➔ 待取件
 * 4. 床簾：不須消毒 ➔ 洗衣機 (40分鐘) ➔ 不須烘衣 ➔ 待取件
 * 5. 一般 / 其他：不須消毒 ➔ 洗衣機 (60分鐘) ➔ 烘衣機 (60分鐘) ➔ 待取件
 */
export function getStandardStepsForCategory(categoryCode: LaundryCategoryKind): PipelineStageStep[] {
  switch (categoryCode) {
    case "DISINFECT":
      return [
        { order: 1, name: "消毒鍋", durationMinutes: 30, equipmentType: "disinfection_tank", status: "pending" },
        { order: 2, name: "洗衣機", durationMinutes: 60, equipmentType: "washer", status: "pending" },
        { order: 3, name: "烘衣機", durationMinutes: 60, equipmentType: "dryer", status: "pending" },
        { order: 4, name: "待取件", durationMinutes: null, equipmentType: "pickup", status: "pending" },
      ];
    case "BIB":
      return [
        { order: 1, name: "烘衣機", durationMinutes: 20, equipmentType: "dryer", status: "pending" },
        { order: 2, name: "待取件", durationMinutes: null, equipmentType: "pickup", status: "pending" },
      ];
    case "CURTAIN":
      return [
        { order: 1, name: "洗衣機", durationMinutes: 40, equipmentType: "washer", status: "pending" },
        { order: 2, name: "待取件", durationMinutes: null, equipmentType: "pickup", status: "pending" },
      ];
    case "SOILED":
      return [
        { order: 1, name: "洗衣機", durationMinutes: 60, equipmentType: "washer", status: "pending" },
        { order: 2, name: "烘衣機", durationMinutes: 60, equipmentType: "dryer", status: "pending" },
        { order: 3, name: "待取件", durationMinutes: null, equipmentType: "pickup", status: "pending" },
      ];
    case "GENERAL":
    default:
      return [
        { order: 1, name: "洗衣機", durationMinutes: 60, equipmentType: "washer", status: "pending" },
        { order: 2, name: "烘衣機", durationMinutes: 60, equipmentType: "dryer", status: "pending" },
        { order: 3, name: "待取件", durationMinutes: null, equipmentType: "pickup", status: "pending" },
      ];
  }
}

/**
 * 完整推導該單之分類品項、所有階段與即時當前階段狀態
 */
export function deriveOrderPipeline(
  order: WorkspaceOrder,
  detail?: WorkspaceOrderDetail | null,
  equipment: WorkspaceEquipment[] = []
): OrderPipelineInfo {
  const { categoryCode, categoryName, categoryTone } = resolveOrderCategory(order, detail);
  const steps = getStandardStepsForCategory(categoryCode);
  const totalStages = steps.length;

  // 1. 待收件 (awaiting_receipt)
  if (order.status === "awaiting_receipt") {
    return {
      categoryCode,
      categoryName,
      categoryTone,
      currentStageName: "待收件 (未開始)",
      currentStageOrder: 0,
      totalStages,
      steps,
    };
  }

  // 2. 已結案 (picked_up)
  if (order.status === "picked_up") {
    steps.forEach((s) => {
      s.status = "completed";
      s.statusLabel = "已完成";
    });
    return {
      categoryCode,
      categoryName,
      categoryTone,
      currentStageName: "已取件結案",
      currentStageOrder: totalStages,
      totalStages,
      steps,
    };
  }

  // 3. 待取件 (ready_for_pickup) 或 6D-1/床簾清洗結束特殊判定
  const isCurtainReady =
    categoryCode === "CURTAIN" &&
    (order.cartNumber?.toUpperCase() === "6D-1" ||
      detail?.batches?.some((b) =>
        b.stages.some((s) => s.equipmentType === "washer" && (s.state === "completed" || s.completedAt))
      ));

  if (order.status === "ready_for_pickup" || isCurtainReady) {
    steps.forEach((s, idx) => {
      if (idx === steps.length - 1) {
        s.status = "current";
        s.statusLabel = "待取件";
      } else {
        s.status = "completed";
        s.statusLabel = "已完成";
      }
    });
    return {
      categoryCode,
      categoryName,
      categoryTone,
      currentStageName: "洗烘完畢 · 待取件",
      currentStageOrder: totalStages,
      totalStages,
      steps,
    };
  }

  // 4. 分類完成待清洗 (awaiting_cleaning)
  if (order.status === "awaiting_cleaning") {
    steps[0].status = "current";
    steps[0].statusLabel =
      categoryCode === "DISINFECT"
        ? "待消毒"
        : categoryCode === "BIB"
        ? "待烘乾"
        : "待清洗";
    return {
      categoryCode,
      categoryName,
      categoryTone,
      currentStageName: steps[0].statusLabel,
      currentStageOrder: 1,
      totalStages,
      steps,
    };
  }

  // 5. 處理中 (in_process)
  // 檢驗批次各階段狀態
  const batch = detail?.batches?.[0];
  const activeStage = batch?.stages.find((s) => s.state === "active");
  const batchCurrentOrder = activeStage?.stageOrder ?? batch?.currentStageOrder ?? 1;

  if (categoryCode === "DISINFECT") {
    // 消毒品：1: 消毒鍋 (30m) ➔ 2: 洗衣機 (60m) ➔ 3: 烘衣機 (60m) ➔ 4: 待取件
    const isDisinfectRunning = activeStage?.equipmentType === "disinfection_tank" || (batchCurrentOrder === 1 && batch?.status === "in_progress");
    const isWashRunning = activeStage?.equipmentType === "washer" || (batchCurrentOrder === 2 && batch?.status === "in_progress");
    const isDryRunning = activeStage?.equipmentType === "dryer" || (batchCurrentOrder >= 3 && batch?.status === "in_progress");

    if (isDisinfectRunning || batchCurrentOrder <= 1) {
      steps[0].status = "current";
      steps[0].statusLabel = isDisinfectRunning ? "消毒中 (30分)" : "待消毒";
      return {
        categoryCode,
        categoryName,
        categoryTone,
        currentStageName: steps[0].statusLabel,
        currentStageOrder: 1,
        totalStages,
        steps,
      };
    } else if (isWashRunning || batchCurrentOrder === 2) {
      steps[0].status = "completed";
      steps[0].statusLabel = "已完成";
      steps[1].status = "current";
      steps[1].statusLabel = isWashRunning ? "清洗中 (60分)" : "待清洗";
      return {
        categoryCode,
        categoryName,
        categoryTone,
        currentStageName: steps[1].statusLabel,
        currentStageOrder: 2,
        totalStages,
        steps,
      };
    } else {
      steps[0].status = "completed";
      steps[0].statusLabel = "已完成";
      steps[1].status = "completed";
      steps[1].statusLabel = "已完成";
      steps[2].status = "current";
      steps[2].statusLabel = isDryRunning ? "烘乾中 (60分)" : "待烘乾";
      return {
        categoryCode,
        categoryName,
        categoryTone,
        currentStageName: steps[2].statusLabel,
        currentStageOrder: 3,
        totalStages,
        steps,
      };
    }
  }

  if (categoryCode === "BIB") {
    // 圍兜：1: 烘衣機 (20m) ➔ 2: 待取件
    const isDryRunning = activeStage?.equipmentType === "dryer" || batch?.status === "in_progress";
    steps[0].status = "current";
    steps[0].statusLabel = isDryRunning ? "烘衣中 (20分)" : "待烘乾";
    return {
      categoryCode,
      categoryName,
      categoryTone,
      currentStageName: steps[0].statusLabel,
      currentStageOrder: 1,
      totalStages,
      steps,
    };
  }

  if (categoryCode === "CURTAIN") {
    // 床簾：1: 洗衣機 (40m) ➔ 2: 待取件 (不須烘衣)
    const isWashDone = batch?.stages.some((s) => s.equipmentType === "washer" && (s.state === "completed" || s.completedAt));
    if (isWashDone) {
      steps[0].status = "completed";
      steps[0].statusLabel = "已完成";
      steps[1].status = "current";
      steps[1].statusLabel = "待取件";
      return {
        categoryCode,
        categoryName,
        categoryTone,
        currentStageName: "清洗完畢 · 待取件",
        currentStageOrder: 2,
        totalStages,
        steps,
      };
    }
    const isWashRunning = activeStage?.equipmentType === "washer" || batch?.status === "in_progress";
    steps[0].status = "current";
    steps[0].statusLabel = isWashRunning ? "清洗中 (40分)" : "待清洗";
    return {
      categoryCode,
      categoryName,
      categoryTone,
      currentStageName: steps[0].statusLabel,
      currentStageOrder: 1,
      totalStages,
      steps,
    };
  }

  // 汙衣與一般：1: 洗衣機 (60m) ➔ 2: 烘衣機 (60m) ➔ 3: 待取件
  const isWashDone =
    batchCurrentOrder >= 2 ||
    batch?.stages.some((s) => s.equipmentType === "washer" && (s.state === "completed" || s.completedAt));
  const isWashRunning = activeStage?.equipmentType === "washer" || (batchCurrentOrder === 1 && batch?.status === "in_progress");
  const isDryRunning = activeStage?.equipmentType === "dryer" || (batchCurrentOrder >= 2 && batch?.status === "in_progress");

  if (!isWashDone) {
    steps[0].status = "current";
    steps[0].statusLabel = isWashRunning ? "清洗中 (60分)" : "待清洗";
    return {
      categoryCode,
      categoryName,
      categoryTone,
      currentStageName: steps[0].statusLabel,
      currentStageOrder: 1,
      totalStages,
      steps,
    };
  } else {
    steps[0].status = "completed";
    steps[0].statusLabel = "已完成";
    steps[1].status = "current";
    steps[1].statusLabel = isDryRunning ? "烘乾中 (60分)" : "待烘乾";
    return {
      categoryCode,
      categoryName,
      categoryTone,
      currentStageName: steps[1].statusLabel,
      currentStageOrder: 2,
      totalStages,
      steps,
    };
  }
}
