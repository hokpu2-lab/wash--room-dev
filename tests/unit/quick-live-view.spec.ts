import { describe, expect, it } from "vitest";
import {
  derivePendingCarts,
  formatClockTime,
} from "../../src/app/app/quick-live-view";
import type {
  WorkspaceOrder,
  WorkspaceOrderDetail,
} from "../../src/lib/analytics/workspace-snapshot";

type Batch = WorkspaceOrderDetail["batches"][number];
type Stage = Batch["stages"][number];

function makeStage(overrides: Partial<Stage> & Pick<Stage, "stageOrder" | "name" | "equipmentType" | "state">): Stage {
  return {
    standardMinutes: 40,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeBatch(overrides: Partial<Batch>): Batch {
  return {
    id: "batch-1",
    batchSequence: 1,
    categoryCode: "NORM",
    categoryName: "一般被服",
    procedureName: "標準洗滌",
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
      totalStandardMinutes: 60,
      isEstimate: false,
    },
    stages: [],
    ...overrides,
  };
}

function makeDetail(overrides: Partial<WorkspaceOrderDetail> & Pick<WorkspaceOrderDetail, "orderId">): WorkspaceOrderDetail {
  return {
    orderCreatedAt: null,
    orderReceivedAt: null,
    orderReadyAt: null,
    orderClosedAt: null,
    batches: [],
    ...overrides,
  };
}

describe("即時洗衣車與設備流轉動態 - 待處理洗衣車推導 (QuickLiveView Pending Carts)", () => {
  it("時間格式化 formatClockTime 應正確格式化上下午與時間", () => {
    expect(formatClockTime(null)).toBe("—");
    expect(formatClockTime("invalid-date")).toBe("—");
    
    const d = new Date("2026-10-12T09:30:00.000Z");
    const result = formatClockTime(d.toISOString());
    expect(result).toMatch(/\d{2}\/\d{2} (上午|下午) \d{2}:\d{2}/);
  });

  it("初始進場待收件單據（awaiting_receipt）應顯示待分類", () => {
    const orders: WorkspaceOrder[] = [
      {
        id: "order-1",
        orderNumber: "MAIN-20261012-0001",
        cartNumber: "1A-1",
        institutionName: "養護中心",
        status: "awaiting_receipt",
        updatedAt: "2026-10-12T08:00:00.000Z",
      },
    ];
    const details: WorkspaceOrderDetail[] = [];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(1);
    expect(pending[0].cartNumber).toBe("1A-1");
    expect(pending[0].nextStageName).toBe("待分類");
    expect(pending[0].nextStageTone).toBe("wash");
    expect(pending[0].isPostStage).toBe(false);
    expect(pending[0].justFinishedStage).toBeNull();
  });

  it("初始進場待收件之特殊消毒單據應顯示待消毒", () => {
    const orders: WorkspaceOrder[] = [
      {
        id: "order-disinfect-1",
        orderNumber: "MAIN-20261012-0002",
        cartNumber: "2C-6",
        institutionName: "護家",
        status: "awaiting_receipt",
        updatedAt: "2026-10-12T08:00:00.000Z",
      },
    ];
    const details: WorkspaceOrderDetail[] = [];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(1);
    expect(pending[0].cartNumber).toBe("2C-6");
    expect(pending[0].nextStageName).toBe("待消毒");
    expect(pending[0].nextStageTone).toBe("disinfect");
    expect(pending[0].isPostStage).toBe(false);
  });

  it("分類後的洗衣車（awaiting_cleaning）應納入待處理洗衣車，一般單顯示待清洗與分類完成", () => {
    const orders: WorkspaceOrder[] = [
      {
        id: "order-classified-1",
        orderNumber: "MAIN-20261012-0003",
        cartNumber: "3B-2",
        institutionName: "安養堂",
        status: "awaiting_cleaning",
        updatedAt: "2026-10-12T08:30:00.000Z",
      },
    ];
    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-classified-1",
        orderCreatedAt: "2026-10-12T08:00:00.000Z",
        orderReceivedAt: "2026-10-12T08:30:00.000Z",
        batches: [
          makeBatch({
            stages: [
              makeStage({ stageOrder: 1, name: "主洗", equipmentType: "washer", state: "pending" }),
              makeStage({ stageOrder: 2, name: "烘乾", equipmentType: "dryer", state: "pending" }),
            ],
          }),
        ],
      }),
    ];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(1);
    expect(pending[0].cartNumber).toBe("3B-2");
    expect(pending[0].isPostStage).toBe(true);
    expect(pending[0].justFinishedStage).toBe("分類完成");
    expect(pending[0].nextStageName).toBe("待清洗");
    expect(pending[0].nextStageTone).toBe("wash");
  });

  it("分類後的洗衣車（awaiting_cleaning）若為消毒分類，應顯示待消毒與分類完成", () => {
    const orders: WorkspaceOrder[] = [
      {
        id: "order-classified-disinfect",
        orderNumber: "MAIN-20261012-0004",
        cartNumber: "5E-9",
        institutionName: "護理之家",
        status: "awaiting_cleaning",
        updatedAt: "2026-10-12T08:45:00.000Z",
      },
    ];
    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-classified-disinfect",
        orderCreatedAt: "2026-10-12T08:15:00.000Z",
        orderReceivedAt: "2026-10-12T08:45:00.000Z",
        batches: [
          makeBatch({
            categoryName: "感染消毒品",
            stages: [
              makeStage({ stageOrder: 1, name: "浸泡消毒", equipmentType: "disinfection_tank", state: "pending" }),
              makeStage({ stageOrder: 2, name: "主洗", equipmentType: "washer", state: "pending" }),
              makeStage({ stageOrder: 3, name: "烘乾", equipmentType: "dryer", state: "pending" }),
            ],
          }),
        ],
      }),
    ];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(1);
    expect(pending[0].cartNumber).toBe("5E-9");
    expect(pending[0].isPostStage).toBe(true);
    expect(pending[0].justFinishedStage).toBe("分類完成");
    expect(pending[0].nextStageName).toBe("待消毒");
    expect(pending[0].nextStageTone).toBe("disinfect");
  });

  it("消毒完成後正等待清洗的洗衣車，應標示消毒完畢並顯示下一階段為待清洗", () => {
    const orders: WorkspaceOrder[] = [
      {
        id: "order-post-disinfect",
        orderNumber: "MAIN-20261008-0001",
        cartNumber: "2C-6",
        institutionName: "護家",
        status: "in_process",
        updatedAt: "2026-10-12T09:00:00.000Z",
      },
    ];
    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-post-disinfect",
        orderCreatedAt: "2026-10-12T08:00:00.000Z",
        batches: [
          makeBatch({
            categoryName: "消毒品",
            currentStageOrder: 2,
            stages: [
              makeStage({ stageOrder: 1, name: "浸泡消毒", equipmentType: "disinfection_tank", state: "completed" }),
              makeStage({ stageOrder: 2, name: "主洗", equipmentType: "washer", state: "pending" }),
              makeStage({ stageOrder: 3, name: "烘乾", equipmentType: "dryer", state: "pending" }),
            ],
          }),
        ],
      }),
    ];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(1);
    expect(pending[0].cartNumber).toBe("2C-6");
    expect(pending[0].isPostStage).toBe(true);
    expect(pending[0].justFinishedStage).toBe("消毒完畢");
    expect(pending[0].nextStageName).toBe("待清洗");
    expect(pending[0].nextStageTone).toBe("wash");
  });

  it("清洗完成後正等待烘乾的洗衣車，應標示清洗完畢並顯示下一階段為待烘乾", () => {
    const orders: WorkspaceOrder[] = [
      {
        id: "order-post-wash",
        orderNumber: "MAIN-20261012-0005",
        cartNumber: "4A-3",
        institutionName: "仁愛院",
        status: "in_process",
        updatedAt: "2026-10-12T09:30:00.000Z",
      },
    ];
    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-post-wash",
        orderCreatedAt: "2026-10-12T08:00:00.000Z",
        batches: [
          makeBatch({
            currentStageOrder: 2,
            stages: [
              makeStage({ stageOrder: 1, name: "主洗", equipmentType: "washer", state: "completed" }),
              makeStage({ stageOrder: 2, name: "烘乾", equipmentType: "dryer", state: "pending" }),
            ],
          }),
        ],
      }),
    ];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(1);
    expect(pending[0].cartNumber).toBe("4A-3");
    expect(pending[0].isPostStage).toBe(true);
    expect(pending[0].justFinishedStage).toBe("清洗完畢");
    expect(pending[0].nextStageName).toBe("待烘乾");
    expect(pending[0].nextStageTone).toBe("dry");
  });

  it("設備中正在運作的洗衣車（active 或 in_progress）不應列入待處理洗衣車", () => {
    const orders: WorkspaceOrder[] = [
      {
        id: "order-running",
        orderNumber: "MAIN-20261012-0006",
        cartNumber: "7C-1",
        institutionName: "博愛家",
        status: "in_process",
        updatedAt: "2026-10-12T09:00:00.000Z",
      },
    ];
    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-running",
        batches: [
          makeBatch({
            status: "in_progress",
            activeEquipmentName: "本館洗衣-1",
            progress: {
              stageRunId: "run-1",
              stageStatus: "in_progress",
              stageProgressPercent: 45,
              overallProgressPercent: 22,
              estimatedStageCompletedAt: null,
              overdueMinutes: 0,
              totalStandardMinutes: 40,
              isEstimate: false,
            },
            stages: [
              makeStage({ stageOrder: 1, name: "主洗", equipmentType: "washer", state: "active" }),
              makeStage({ stageOrder: 2, name: "烘乾", equipmentType: "dryer", state: "pending" }),
            ],
          }),
        ],
      }),
    ];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(0);
  });

  it("已完成待取件（ready_for_pickup）或已取件（picked_up）的洗衣車不應列入待處理洗衣車", () => {
    const orders: WorkspaceOrder[] = [
      {
        id: "order-ready",
        orderNumber: "MAIN-20261012-0007",
        cartNumber: "1A-8",
        institutionName: "長青樓",
        status: "ready_for_pickup",
        updatedAt: "2026-10-12T09:50:00.000Z",
      },
      {
        id: "order-picked",
        orderNumber: "MAIN-20261012-0008",
        cartNumber: "2B-4",
        institutionName: "松柏院",
        status: "picked_up",
        updatedAt: "2026-10-12T10:00:00.000Z",
      },
    ];
    const details: WorkspaceOrderDetail[] = [];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(0);
  });
});
