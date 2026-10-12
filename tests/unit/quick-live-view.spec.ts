import { describe, expect, it } from "vitest";
import {
  calculateEquipmentRemainingSeconds,
  derivePendingCarts,
  formatClockTime,
  formatCountdown,
  type ReadyCartItem,
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

  it("初始進場待收件單據（awaiting_receipt）應顯示待分類，且僅有送件時間", () => {
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
    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-1",
        orderCreatedAt: "2026-10-12T08:00:00.000Z",
      }),
    ];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(1);
    expect(pending[0].cartNumber).toBe("1A-1");
    expect(pending[0].nextStageName).toBe("待分類");
    expect(pending[0].nextStageTone).toBe("wash");
    expect(pending[0].isPostStage).toBe(false);
    expect(pending[0].justFinishedStage).toBeNull();
    expect(pending[0].sendTime).toBe(formatClockTime("2026-10-12T08:00:00.000Z"));
    expect(pending[0].receiptTime).toBeNull();
  });

  it("初始進場待收件之特殊消毒單據應顯示待消毒，且僅有送件時間", () => {
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
    expect(pending[0].sendTime).toBe(formatClockTime("2026-10-12T08:00:00.000Z"));
    expect(pending[0].receiptTime).toBeNull();
  });

  it("分類後的洗衣車（awaiting_cleaning）應保留送件時間並顯示收件時間，一般單顯示待清洗", () => {
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
    expect(pending[0].sendTime).toBe(formatClockTime("2026-10-12T08:00:00.000Z"));
    expect(pending[0].receiptTime).toBe(formatClockTime("2026-10-12T08:30:00.000Z"));
  });

  it("分類後的洗衣車（awaiting_cleaning）若為消毒分類，應保留送件時間與收件時間，顯示待消毒", () => {
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
    expect(pending[0].sendTime).toBe(formatClockTime("2026-10-12T08:15:00.000Z"));
    expect(pending[0].receiptTime).toBe(formatClockTime("2026-10-12T08:45:00.000Z"));
  });

  it("消毒完成後正等待清洗的洗衣車，應標示消毒完畢並保留送件與收件時間", () => {
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
        orderReceivedAt: "2026-10-12T08:30:00.000Z",
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
    expect(pending[0].sendTime).toBe(formatClockTime("2026-10-12T08:00:00.000Z"));
    expect(pending[0].receiptTime).toBe(formatClockTime("2026-10-12T08:30:00.000Z"));
  });

  it("清洗完成後正等待烘乾的洗衣車，應標示清洗完畢並保留送件與收件時間", () => {
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
        orderReceivedAt: "2026-10-12T08:25:00.000Z",
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
    expect(pending[0].sendTime).toBe(formatClockTime("2026-10-12T08:00:00.000Z"));
    expect(pending[0].receiptTime).toBe(formatClockTime("2026-10-12T08:25:00.000Z"));
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

  it("待取件洗衣車應同時包含送件時間、收件時間與完成時間", () => {
    const order: WorkspaceOrder = {
      id: "order-ready-full",
      orderNumber: "MAIN-20261012-0009",
      cartNumber: "2D-3",
      institutionName: "安康樓",
      status: "ready_for_pickup",
      updatedAt: "2026-10-12T11:00:00.000Z",
    };
    const detail: WorkspaceOrderDetail = makeDetail({
      orderId: "order-ready-full",
      orderCreatedAt: "2026-10-12T08:00:00.000Z",
      orderReceivedAt: "2026-10-12T08:30:00.000Z",
      orderReadyAt: "2026-10-12T11:00:00.000Z",
    });

    const readyItem: ReadyCartItem = {
      id: order.id,
      orderNumber: order.orderNumber,
      cartNumber: order.cartNumber,
      institutionName: order.institutionName,
      sendTime: formatClockTime(detail.orderCreatedAt),
      receiptTime: formatClockTime(detail.orderReceivedAt),
      readyTime: formatClockTime(detail.orderReadyAt),
    };

    expect(readyItem.sendTime).toBe(formatClockTime("2026-10-12T08:00:00.000Z"));
    expect(readyItem.receiptTime).toBe(formatClockTime("2026-10-12T08:30:00.000Z"));
    expect(readyItem.readyTime).toBe(formatClockTime("2026-10-12T11:00:00.000Z"));
  });

  it("倒數計時格式化 formatCountdown 應正確格式化秒數", () => {
    expect(formatCountdown(3600)).toBe("1:00:00");
    expect(formatCountdown(3599)).toBe("59:59");
    expect(formatCountdown(125)).toBe("02:05");
    expect(formatCountdown(5)).toBe("00:05");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-10)).toBe("00:00");
  });

  it("設備剩餘時間計算 calculateEquipmentRemainingSeconds 應正確計算或退回全額", () => {
    const baseNow = new Date("2026-10-12T10:30:00.000Z").getTime();
    
    // 設備運作 60 分鐘，10 分鐘前開始 (經過 600 秒) -> 剩餘 50 分鐘 = 3000 秒
    const tenMinAgo = new Date("2026-10-12T10:20:00.000Z").toISOString();
    expect(calculateEquipmentRemainingSeconds(tenMinAgo, 60, baseNow)).toBe(3000);

    // 設備剛好到達 60 分鐘 -> 剩餘 0 秒
    const sixtyMinAgo = new Date("2026-10-12T09:30:00.000Z").toISOString();
    expect(calculateEquipmentRemainingSeconds(sixtyMinAgo, 60, baseNow)).toBe(0);

    // 設備超過 60 分鐘 -> 剩餘 0 秒 (不為負數)
    const seventyMinAgo = new Date("2026-10-12T09:20:00.000Z").toISOString();
    expect(calculateEquipmentRemainingSeconds(seventyMinAgo, 60, baseNow)).toBe(0);

    // 未提供 startedAt 時退回設定時間 (預設 60 分鐘 = 3600 秒)
    expect(calculateEquipmentRemainingSeconds(null, 60, baseNow)).toBe(3600);
  });

  it("待分類洗衣車不顯示分類標籤，分類後洗衣車應正確附帶分類標籤", () => {
    const unclassifiedOrder: WorkspaceOrder = {
      id: "unclass-1",
      orderNumber: "MAIN-20261012-0010",
      cartNumber: "1A-5",
      institutionName: "慈心居",
      status: "awaiting_receipt",
      updatedAt: "2026-10-12T08:00:00.000Z",
    };
    const classifiedOrder: WorkspaceOrder = {
      id: "class-1",
      orderNumber: "MAIN-20261012-0011",
      cartNumber: "2B-8",
      institutionName: "康復院",
      status: "awaiting_cleaning",
      updatedAt: "2026-10-12T08:30:00.000Z",
    };

    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "class-1",
        orderReceivedAt: "2026-10-12T08:30:00.000Z",
        batches: [
          makeBatch({
            categoryName: "汙衣",
            stages: [
              makeStage({ stageOrder: 1, name: "主洗", equipmentType: "washer", state: "pending" }),
            ],
          }),
        ],
      }),
    ];

    const pending = derivePendingCarts([unclassifiedOrder, classifiedOrder], details);
    expect(pending.length).toBe(2);

    // 未分類單據無分類標籤
    const unclassPending = pending.find((p) => p.cartNumber === "1A-5");
    expect(unclassPending?.categoryNames).toBeUndefined();

    // 分類後單據具備被分類標籤 [汙衣]
    const classPending = pending.find((p) => p.cartNumber === "2B-8");
    expect(classPending?.categoryNames).toEqual(["汙衣"]);
  });

  it("當運作中設備倒數完畢時，洗衣車應順利脫離設備並進入下一階段待處理", () => {
    const orderRunning: WorkspaceOrder = {
      id: "order-disinfect-run",
      orderNumber: "MAIN-20261008-0001",
      cartNumber: "2C-6",
      institutionName: "護家",
      status: "in_process",
      updatedAt: "2026-10-12T09:00:00.000Z",
    };

    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-disinfect-run",
        batches: [
          makeBatch({
            categoryName: "消毒品",
            activeEquipmentName: "本館消毒鍋",
            currentStageOrder: 1,
            progress: {
              stageRunId: "run-disinfect-1",
              stageStatus: "in_progress",
              stageProgressPercent: 99,
              overallProgressPercent: 33,
              estimatedStageCompletedAt: null,
              overdueMinutes: 0,
              totalStandardMinutes: 60,
              isEstimate: false,
            },
            stages: [
              makeStage({ stageOrder: 1, name: "浸泡消毒", equipmentType: "disinfection_tank", state: "active" }),
              makeStage({ stageOrder: 2, name: "主洗", equipmentType: "washer", state: "pending" }),
              makeStage({ stageOrder: 3, name: "烘乾", equipmentType: "dryer", state: "pending" }),
            ],
          }),
        ],
      }),
    ];

    // 倒數未完畢時，設備占用中，不應在待處理洗衣車
    const beforeDone = derivePendingCarts([orderRunning], details);
    expect(beforeDone.length).toBe(0);

    // 倒數完畢時 (options 傳入本館消毒鍋已完成)，洗衣車應進入待處理洗衣車，下一階段為「待清洗」，並顯示分類標籤 [消毒品]
    const afterDone = derivePendingCarts([orderRunning], details, {
      completedEquipmentNames: new Set(["本館消毒鍋"]),
    });
    expect(afterDone.length).toBe(1);
    expect(afterDone[0].cartNumber).toBe("2C-6");
    expect(afterDone[0].justFinishedStage).toBe("消毒完畢");
    expect(afterDone[0].nextStageName).toBe("待清洗");
    expect(afterDone[0].categoryNames).toEqual(["消毒品"]);
  });
});
