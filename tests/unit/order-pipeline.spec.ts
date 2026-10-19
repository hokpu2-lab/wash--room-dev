import { describe, expect, it } from "vitest";
import {
  deriveOrderPipeline,
  getStandardStepsForCategory,
  resolveOrderCategory,
} from "@/lib/laundry-schedule/order-pipeline";
import type { WorkspaceOrder, WorkspaceOrderDetail } from "@/lib/analytics/workspace-snapshot";

describe("洗衣排程品項與流程管線推導 (Order Pipeline & Stages)", () => {
  const baseOrder: WorkspaceOrder = {
    id: "11111111-1111-4000-8000-111111111111",
    orderNumber: "ORD-20261014-0001",
    status: "in_process",
    updatedAt: "2026-10-14T10:00:00Z",
    institutionName: "菩提仁愛之家",
    cartNumber: "3A-1",
  };

  it("標準流程步驟定義應符合五大分類規範", () => {
    // 消毒品：消毒鍋 30m ➔ 洗衣機 60m ➔ 烘衣機 60m ➔ 待取件
    const disinfectSteps = getStandardStepsForCategory("DISINFECT");
    expect(disinfectSteps).toHaveLength(4);
    expect(disinfectSteps[0].name).toBe("消毒鍋");
    expect(disinfectSteps[0].durationMinutes).toBe(30);
    expect(disinfectSteps[1].name).toBe("洗衣機");
    expect(disinfectSteps[1].durationMinutes).toBe(60);
    expect(disinfectSteps[2].name).toBe("烘衣機");
    expect(disinfectSteps[2].durationMinutes).toBe(60);
    expect(disinfectSteps[3].name).toBe("待取件");

    // 圍兜：不須消毒 ➔ 不須清洗 ➔ 烘衣機 20m ➔ 待取件
    const bibSteps = getStandardStepsForCategory("BIB");
    expect(bibSteps).toHaveLength(2);
    expect(bibSteps[0].name).toBe("烘衣機");
    expect(bibSteps[0].durationMinutes).toBe(20);
    expect(bibSteps[1].name).toBe("待取件");

    // 床簾：不須消毒 ➔ 洗衣機 40m ➔ 不須烘衣 ➔ 待取件
    const curtainSteps = getStandardStepsForCategory("CURTAIN");
    expect(curtainSteps).toHaveLength(2);
    expect(curtainSteps[0].name).toBe("洗衣機");
    expect(curtainSteps[0].durationMinutes).toBe(40);
    expect(curtainSteps[1].name).toBe("待取件");

    // 汙衣：不須消毒 ➔ 洗衣機 60m ➔ 烘衣機 60m ➔ 待取件
    const soiledSteps = getStandardStepsForCategory("SOILED");
    expect(soiledSteps).toHaveLength(3);
    expect(soiledSteps[0].name).toBe("洗衣機");
    expect(soiledSteps[0].durationMinutes).toBe(60);
    expect(soiledSteps[1].name).toBe("烘衣機");
    expect(soiledSteps[1].durationMinutes).toBe(60);

    // 一般品：不須消毒 ➔ 洗衣機 60m ➔ 烘衣機 60m ➔ 待取件
    const generalSteps = getStandardStepsForCategory("GENERAL");
    expect(generalSteps).toHaveLength(3);
    expect(generalSteps[0].name).toBe("洗衣機");
    expect(generalSteps[0].durationMinutes).toBe(60);
    expect(generalSteps[1].name).toBe("烘衣機");
    expect(generalSteps[1].durationMinutes).toBe(60);
  });

  it("依車號與批次分類準確推導品項", () => {
    // 批次詳情包含消毒分類
    const disinfectDetail: WorkspaceOrderDetail = {
      orderId: baseOrder.id,
      orderCreatedAt: "2026-10-14T09:00:00Z",
      orderReceivedAt: "2026-10-14T09:10:00Z",
      orderReadyAt: null,
      orderClosedAt: null,
      batches: [
        {
          id: "batch-disinfect",
          batchSequence: 1,
          categoryCode: "DISINFECT",
          categoryName: "消毒品",
          procedureName: "消毒程序",
          procedureVersion: 1,
          status: "in_progress",
          currentStageOrder: 1,
          activeEquipmentName: "本館消毒鍋",
          activeEquipmentType: "disinfection_tank",
          progress: {
            stageRunId: null,
            stageStatus: "in_progress",
            stageProgressPercent: 50,
            overallProgressPercent: 50,
            estimatedStageCompletedAt: null,
            overdueMinutes: 0,
            totalStandardMinutes: 150,
            isEstimate: false,
          },
          stages: [
            { stageOrder: 1, name: "消毒", standardMinutes: 30, equipmentType: "disinfection_tank", state: "active", startedAt: null, completedAt: null },
          ],
        },
      ],
    };
    expect(resolveOrderCategory({ ...baseOrder, cartNumber: "8D-1" }, disinfectDetail).categoryCode).toBe("DISINFECT");
    expect(resolveOrderCategory({ ...baseOrder, cartNumber: "2C-6" }, disinfectDetail).categoryCode).toBe("DISINFECT");

    // 特殊單號回退判定
    expect(resolveOrderCategory({ ...baseOrder, orderNumber: "MAIN-20261005-0004" }).categoryCode).toBe("DISINFECT");

    // 圍兜 8D-1 實體車：若批次分類為圍兜，必須推導為 BIB 圍兜，不可被車號誤判為消毒品
    const bibDetail: WorkspaceOrderDetail = {
      orderId: baseOrder.id,
      orderCreatedAt: "2026-10-14T09:00:00Z",
      orderReceivedAt: "2026-10-14T09:10:00Z",
      orderReadyAt: null,
      orderClosedAt: null,
      batches: [
        {
          id: "batch-1",
          batchSequence: 1,
          categoryCode: "BIB",
          categoryName: "圍兜",
          procedureName: "圍兜程序",
          procedureVersion: 1,
          status: "in_progress",
          currentStageOrder: 1,
          activeEquipmentName: "烘衣機 A",
          activeEquipmentType: "dryer",
          progress: {
            stageRunId: null,
            stageStatus: "in_progress",
            stageProgressPercent: 50,
            overallProgressPercent: 50,
            estimatedStageCompletedAt: null,
            overdueMinutes: 0,
            totalStandardMinutes: 20,
            isEstimate: false,
          },
          stages: [
            { stageOrder: 1, name: "烘乾", standardMinutes: 20, equipmentType: "dryer", state: "active", startedAt: null, completedAt: null },
          ],
        },
      ],
    };
    expect(resolveOrderCategory(baseOrder, bibDetail).categoryCode).toBe("BIB");
  });

  it("待收件狀態應標示全階段 pending", () => {
    const pipeline = deriveOrderPipeline({ ...baseOrder, status: "awaiting_receipt" });
    expect(pipeline.currentStageName).toBe("待收件 (未開始)");
    expect(pipeline.steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("待取件狀態應標示前置設備完工，待取件階段為 current", () => {
    const pipeline = deriveOrderPipeline({ ...baseOrder, status: "ready_for_pickup" });
    expect(pipeline.currentStageName).toContain("待取件");
    const lastStep = pipeline.steps[pipeline.steps.length - 1];
    expect(lastStep.status).toBe("current");
    expect(lastStep.name).toBe("待取件");
    expect(pipeline.steps.slice(0, -1).every((s) => s.status === "completed")).toBe(true);
  });

  it("消毒品於第 2 階段洗衣機進行中時，消毒鍋應 completed，洗衣機 current", () => {
    const disinfectDetail: WorkspaceOrderDetail = {
      orderId: baseOrder.id,
      orderCreatedAt: "2026-10-14T09:00:00Z",
      orderReceivedAt: "2026-10-14T09:05:00Z",
      orderReadyAt: null,
      orderClosedAt: null,
      batches: [
        {
          id: "batch-disinfect",
          batchSequence: 1,
          categoryCode: "DISINFECT",
          categoryName: "消毒品",
          procedureName: "消毒品程序",
          procedureVersion: 1,
          status: "in_progress",
          currentStageOrder: 2,
          activeEquipmentName: "洗衣機 1 號",
          activeEquipmentType: "washer",
          progress: {
            stageRunId: null,
            stageStatus: "in_progress",
            stageProgressPercent: 30,
            overallProgressPercent: 50,
            estimatedStageCompletedAt: null,
            overdueMinutes: 0,
            totalStandardMinutes: 150,
            isEstimate: false,
          },
          stages: [
            { stageOrder: 1, name: "消毒", standardMinutes: 30, equipmentType: "disinfection_tank", state: "completed", startedAt: null, completedAt: "2026-10-14T09:30:00Z" },
            { stageOrder: 2, name: "清洗", standardMinutes: 60, equipmentType: "washer", state: "active", startedAt: "2026-10-14T09:35:00Z", completedAt: null },
            { stageOrder: 3, name: "烘乾", standardMinutes: 60, equipmentType: "dryer", state: "pending", startedAt: null, completedAt: null },
          ],
        },
      ],
    };

    const pipeline = deriveOrderPipeline({ ...baseOrder, cartNumber: "8D-1" }, disinfectDetail);
    expect(pipeline.categoryName).toBe("消毒品");
    expect(pipeline.steps[0].name).toBe("消毒鍋");
    expect(pipeline.steps[0].status).toBe("completed");
    expect(pipeline.steps[1].name).toBe("洗衣機");
    expect(pipeline.steps[1].status).toBe("current");
    expect(pipeline.steps[1].statusLabel).toContain("清洗中");
    expect(pipeline.steps[2].status).toBe("pending");
  });

  it("床簾 6D-1 清洗完成後直達待取件", () => {
    const pipeline = deriveOrderPipeline({ ...baseOrder, cartNumber: "6D-1", status: "in_process" });
    expect(pipeline.categoryName).toBe("床簾");
    expect(pipeline.steps).toHaveLength(2);
    expect(pipeline.steps[0].name).toBe("洗衣機");
    expect(pipeline.steps[0].status).toBe("completed");
    expect(pipeline.steps[1].name).toBe("待取件");
    expect(pipeline.steps[1].status).toBe("current");
  });
});
