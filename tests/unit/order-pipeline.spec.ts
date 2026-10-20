import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getOrderQueueStatusDisplay } from "@/app/app/live-queue";
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

  it("當設備被設定為停用（inactive）時，洗衣單排程階段立即標記為烘乾暫停", () => {
    const bibDetail: WorkspaceOrderDetail = {
      orderId: baseOrder.id,
      orderCreatedAt: "2026-10-19T07:00:00Z",
      orderReceivedAt: "2026-10-19T07:05:00Z",
      orderReadyAt: null,
      orderClosedAt: null,
      batches: [
        {
          id: "batch-bib",
          batchSequence: 1,
          categoryCode: "BIB",
          categoryName: "圍兜",
          procedureName: "圍兜烘乾",
          procedureVersion: 1,
          status: "in_progress",
          currentStageOrder: 1,
          activeEquipmentName: "本館烘衣-1",
          activeEquipmentType: "dryer",
          progress: {
            stageRunId: null,
            stageStatus: "in_progress",
            stageProgressPercent: 40,
            overallProgressPercent: 40,
            estimatedStageCompletedAt: null,
            overdueMinutes: 0,
            totalStandardMinutes: 20,
            isEstimate: false,
          },
          stages: [
            { stageOrder: 1, name: "烘乾", standardMinutes: 20, equipmentType: "dryer", state: "active", startedAt: "2026-10-19T07:10:00Z", completedAt: null },
          ],
        },
      ],
    };

    const equipmentList = [
      {
        id: "dryer-1",
        name: "本館烘衣-1",
        equipmentType: "dryer" as const,
        status: "inactive" as const,
        occupied: true,
      },
    ];

    const pipeline = deriveOrderPipeline(
      { ...baseOrder, cartNumber: "7E-1", status: "in_process" },
      bibDetail,
      equipmentList
    );

    expect(pipeline.categoryName).toBe("圍兜");
    expect(pipeline.steps[0].name).toBe("烘衣機");
    expect(pipeline.steps[0].status).toBe("current");
    expect(pipeline.steps[0].statusLabel).toBe("烘乾暫停");
    expect(pipeline.currentStageName).toBe("烘乾暫停");
  });

  it("當批次狀態為 paused 時，排程階段準確標記為暫停", () => {
    const pausedDetail: WorkspaceOrderDetail = {
      orderId: baseOrder.id,
      orderCreatedAt: "2026-10-19T07:00:00Z",
      orderReceivedAt: "2026-10-19T07:05:00Z",
      orderReadyAt: null,
      orderClosedAt: null,
      batches: [
        {
          id: "batch-paused",
          batchSequence: 1,
          categoryCode: "GENERAL",
          categoryName: "一般被服",
          procedureName: "標準洗滌",
          procedureVersion: 1,
          status: "paused",
          currentStageOrder: 1,
          activeEquipmentName: "本館洗衣-1",
          activeEquipmentType: "washer",
          progress: {
            stageRunId: null,
            stageStatus: "paused",
            stageProgressPercent: 30,
            overallProgressPercent: 15,
            estimatedStageCompletedAt: null,
            overdueMinutes: 0,
            totalStandardMinutes: 120,
            isEstimate: false,
          },
          stages: [
            { stageOrder: 1, name: "清洗", standardMinutes: 60, equipmentType: "washer", state: "active", startedAt: "2026-10-19T07:10:00Z", completedAt: null },
            { stageOrder: 2, name: "烘乾", standardMinutes: 60, equipmentType: "dryer", state: "pending", startedAt: null, completedAt: null },
          ],
        },
      ],
    };

    const pipeline = deriveOrderPipeline(
      { ...baseOrder, cartNumber: "1A-1", status: "in_process" },
      pausedDetail
    );

    expect(pipeline.steps[0].statusLabel).toBe("清洗暫停");
    expect(pipeline.currentStageName).toBe("清洗暫停");
  });
});

describe("排程佇列狀態膠囊文字與色彩樣式對齊 (Order Queue Status Alignment)", () => {
  const baseOrder: WorkspaceOrder = {
    id: "order-test-1",
    orderNumber: "MAIN-20261020-0001",
    status: "awaiting_cleaning",
    updatedAt: "2026-10-20T08:00:00Z",
    institutionName: "晴禾護理之家",
    cartNumber: "7E-1",
  };

  it("圍兜單據在待烘乾階段應呈現「待烘乾」與橘色膠囊樣式", () => {
    const bibDetail: WorkspaceOrderDetail = {
      orderId: "order-test-1",
      orderCreatedAt: "2026-10-20T08:00:00Z",
      orderReceivedAt: "2026-10-20T08:05:00Z",
      orderReadyAt: null,
      orderClosedAt: null,
      batches: [
        {
          id: "batch-bib",
          batchSequence: 1,
          categoryCode: "BIB",
          categoryName: "圍兜",
          procedureName: "圍兜純烘",
          procedureVersion: 1,
          status: "not_started",
          currentStageOrder: 1,
          activeEquipmentName: null,
          activeEquipmentType: null,
          progress: {
            stageRunId: null,
            stageStatus: null,
            stageProgressPercent: 0,
            overallProgressPercent: 0,
            estimatedStageCompletedAt: null,
            overdueMinutes: 0,
            totalStandardMinutes: 20,
            isEstimate: false,
          },
          stages: [
            { stageOrder: 1, name: "烘乾", standardMinutes: 20, equipmentType: "dryer", state: "pending", startedAt: null, completedAt: null },
          ],
        },
      ],
    };

    const pipeline = deriveOrderPipeline({ ...baseOrder, cartNumber: "7E-1" }, bibDetail);
    const result = getOrderQueueStatusDisplay({ ...baseOrder, cartNumber: "7E-1" }, pipeline);
    expect(result.label).toBe("待烘乾");
    expect(result.className).toContain("statusPillOrange");
  });

  it("待收件單據應呈現「待收件」與灰藍色膠囊樣式", () => {
    const order: WorkspaceOrder = { ...baseOrder, status: "awaiting_receipt" };
    const pipeline = deriveOrderPipeline(order, null);
    const result = getOrderQueueStatusDisplay(order, pipeline);
    expect(result.label).toBe("待收件");
    expect(result.className).toContain("statusPillGray");
  });

  it("待取件單據應呈現「待取件」與綠色膠囊樣式", () => {
    const order: WorkspaceOrder = { ...baseOrder, status: "ready_for_pickup" };
    const pipeline = deriveOrderPipeline(order, null);
    const result = getOrderQueueStatusDisplay(order, pipeline);
    expect(result.label).toBe("待取件");
    expect(result.className).toContain("statusPillGreen");
  });

  it("自訂分類「快烘」應被識別為純烘乾品項，流程僅有烘衣機與待取件，且狀態為「待烘乾」", () => {
    const quickDryDetail: WorkspaceOrderDetail = {
      orderId: "order-quick-dry",
      orderCreatedAt: "2026-10-20T08:00:00Z",
      orderReceivedAt: "2026-10-20T08:05:00Z",
      orderReadyAt: null,
      orderClosedAt: null,
      batches: [
        {
          id: "batch-quick-dry",
          batchSequence: 1,
          categoryCode: "CUSTOM_DRY",
          categoryName: "快烘",
          procedureName: "快速烘乾程序",
          procedureVersion: 1,
          status: "not_started",
          currentStageOrder: 1,
          activeEquipmentName: null,
          activeEquipmentType: null,
          progress: {
            stageRunId: null,
            stageStatus: null,
            stageProgressPercent: 0,
            overallProgressPercent: 0,
            estimatedStageCompletedAt: null,
            overdueMinutes: 0,
            totalStandardMinutes: 20,
            isEstimate: false,
          },
          stages: [
            { stageOrder: 1, name: "烘衣", standardMinutes: 20, equipmentType: "dryer", state: "pending", startedAt: null, completedAt: null },
          ],
        },
      ],
    };

    const order: WorkspaceOrder = {
      id: "order-quick-dry",
      orderNumber: "MAIN-20261020-0099",
      cartNumber: "2C-2",
      institutionName: "護家",
      status: "awaiting_cleaning",
      updatedAt: "2026-10-20T08:05:00Z",
    };

    // 1. 分類名稱必須保留「快烘」，不可被改為「一般」
    const categoryInfo = resolveOrderCategory(order, quickDryDetail);
    expect(categoryInfo.categoryName).toBe("快烘");
    expect(categoryInfo.categoryTone).toBe("bib");

    // 2. 流程步驟應只有烘衣機與待取件，絕對不可有洗衣機
    const pipeline = deriveOrderPipeline(order, quickDryDetail);
    expect(pipeline.steps.map((s) => s.name)).toEqual(["烘衣機", "待取件"]);
    expect(pipeline.steps.some((s) => s.equipmentType === "washer")).toBe(false);

    // 3. 狀態應為「待烘乾」，不可為「待清洗」
    expect(pipeline.currentStageName).toBe("待烘乾");
    const statusDisplay = getOrderQueueStatusDisplay(order, pipeline);
    expect(statusDisplay.label).toBe("待烘乾");
    expect(statusDisplay.className).toContain("statusPillOrange");
  });
});