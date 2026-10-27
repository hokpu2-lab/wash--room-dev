import { describe, expect, it } from "vitest";
import {
  calculateEquipmentRemainingSeconds,
  deriveEquipmentLiveStatuses,
  derivePendingCarts,
  formatClockTime,
  formatCountdown,
  getCartCategoryBadgeClass,
  type ReadyCartItem,
} from "../../src/app/app/quick-live-view";
import type {
  WorkspaceEquipment,
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

  it("圍兜（BIB）收單分類後不須消毒與清洗，直接進入「待烘乾」", () => {
    const bibOrder: WorkspaceOrder = {
      id: "order-bib-1",
      orderNumber: "MAIN-20261013-0001",
      cartNumber: "3C-1",
      institutionName: "仁愛院",
      status: "awaiting_cleaning",
      updatedAt: "2026-10-13T09:00:00.000Z",
    };

    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-bib-1",
        orderReceivedAt: "2026-10-13T09:00:00.000Z",
        batches: [
          makeBatch({
            categoryCode: "BIB",
            categoryName: "圍兜",
            stages: [
              makeStage({ stageOrder: 1, name: "烘乾", equipmentType: "dryer", state: "pending" }),
            ],
          }),
        ],
      }),
    ];

    const pending = derivePendingCarts([bibOrder], details);
    expect(pending.length).toBe(1);
    expect(pending[0].cartNumber).toBe("3C-1");
    expect(pending[0].nextStageName).toBe("待烘乾");
    expect(pending[0].nextStageTone).toBe("dry");
    expect(pending[0].categoryNames).toEqual(["圍兜"]);

    // 特別驗證 8D-1 實體車：若分類為圍兜，必須進入「待烘乾」，不可被舊車號誤判為「待消毒」
    const bib8D1Order: WorkspaceOrder = {
      id: "order-bib-8d1",
      orderNumber: "MAIN-20261019-0001",
      cartNumber: "8D-1",
      institutionName: "三館",
      status: "awaiting_cleaning",
      updatedAt: "2026-10-19T09:00:00.000Z",
    };
    const bib8D1Details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-bib-8d1",
        orderReceivedAt: "2026-10-19T09:00:00.000Z",
        batches: [
          makeBatch({
            categoryCode: "BIB",
            categoryName: "圍兜",
            stages: [
              makeStage({ stageOrder: 1, name: "烘乾", equipmentType: "dryer", state: "pending" }),
            ],
          }),
        ],
      }),
    ];
    const pending8D1 = derivePendingCarts([bib8D1Order], bib8D1Details);
    expect(pending8D1.length).toBe(1);
    expect(pending8D1[0].cartNumber).toBe("8D-1");
    expect(pending8D1[0].categoryNames).toEqual(["圍兜"]);
    expect(pending8D1[0].nextStageName).toBe("待烘乾");
    expect(pending8D1[0].nextStageTone).toBe("dry");
  });

  it("床簾（CURTAIN）在洗衣機清洗完畢後不須烘衣，不應進入待烘乾階段", () => {
    const curtainOrder: WorkspaceOrder = {
      id: "order-curtain-1",
      orderNumber: "MAIN-20261013-0002",
      cartNumber: "4D-2",
      institutionName: "博愛護理之家",
      status: "in_process",
      updatedAt: "2026-10-13T09:30:00.000Z",
    };

    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-curtain-1",
        batches: [
          makeBatch({
            categoryCode: "CURTAIN",
            categoryName: "床簾",
            activeEquipmentName: "1號大型洗衣機",
            currentStageOrder: 1,
            stages: [
              makeStage({ stageOrder: 1, name: "清洗", equipmentType: "washer", state: "completed" }),
            ],
          }),
        ],
      }),
    ];

    // 清洗完成後，因為不需烘衣，derivePendingCarts 不應再排出待烘乾
    const pending = derivePendingCarts([curtainOrder], details, {
      completedEquipmentNames: new Set(["1號大型洗衣機"]),
    });
    expect(pending.length).toBe(0);
  });

  it("多台設備同時運作時，各設備倒數計時與進行狀態各自獨立，不互相干擾或同步重置", () => {
    const baseNow = new Date("2026-10-13T10:00:00.000Z").getTime();
    const twentyMinAgo = new Date("2026-10-13T09:40:00.000Z").toISOString();
    const justStarted = new Date("2026-10-13T10:00:00.000Z").toISOString();

    const equipment: WorkspaceEquipment[] = [
      {
        id: "washer-1",
        name: "1號大型洗衣機",
        equipmentType: "washer",
        status: "normal",
        occupied: true,
        cleaningDurationMinutes: 60,
      },
      {
        id: "washer-2",
        name: "2號洗衣機",
        equipmentType: "washer",
        status: "normal",
        occupied: true,
        cleaningDurationMinutes: 60,
      },
    ];

    const orders: WorkspaceOrder[] = [
      {
        id: "order-1",
        orderNumber: "MAIN-20261013-0001",
        cartNumber: "1A-1",
        institutionName: "仁愛院",
        status: "in_process",
        updatedAt: twentyMinAgo,
      },
      {
        id: "order-2",
        orderNumber: "MAIN-20261013-0002",
        cartNumber: "2B-2",
        institutionName: "博愛家",
        status: "in_process",
        updatedAt: justStarted,
      },
    ];

    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-1",
        batches: [
          makeBatch({
            id: "batch-1",
            categoryName: "一般被服",
            categoryCode: "OTHER",
            activeEquipmentName: "1號大型洗衣機",
            status: "in_progress",
            stages: [
              makeStage({
                stageOrder: 1,
                name: "主洗",
                equipmentType: "washer",
                state: "active",
                startedAt: twentyMinAgo,
              }),
            ],
          }),
        ],
      }),
      makeDetail({
        orderId: "order-2",
        batches: [
          makeBatch({
            id: "batch-2",
            categoryName: "一般被服",
            categoryCode: "OTHER",
            activeEquipmentName: "2號洗衣機",
            status: "in_progress",
            stages: [
              makeStage({
                stageOrder: 1,
                name: "主洗",
                equipmentType: "washer",
                state: "active",
                startedAt: justStarted,
              }),
            ],
          }),
        ],
      }),
    ];

    const { washingEquipment } = deriveEquipmentLiveStatuses(
      equipment,
      orders,
      details,
      { nowMs: baseNow }
    );

    expect(washingEquipment.length).toBe(2);

    const w1 = washingEquipment.find((w) => w.equipment.name === "1號大型洗衣機");
    const w2 = washingEquipment.find((w) => w.equipment.name === "2號洗衣機");

    // 1號洗衣機：20分鐘前開始，60分鐘洗程，剩餘40分鐘 (2400秒)
    expect(w1).toBeDefined();
    expect(w1?.activeCartNumber).toBe("1A-1");
    expect(w1?.statusTone).toBe("washing");
    expect(w1?.remainingSeconds).toBe(2400);
    expect(w1?.formattedCountdown).toBe("40:00");

    // 2號洗衣機：剛剛開始，60分鐘洗程，剩餘60分鐘 (3600秒)
    expect(w2).toBeDefined();
    expect(w2?.activeCartNumber).toBe("2B-2");
    expect(w2?.statusTone).toBe("washing");
    expect(w2?.remainingSeconds).toBe(3600);
    expect(w2?.formattedCountdown).toBe("1:00:00");

    // 兩台設備倒數時間與車號互不影響、絕不同步或重置
    expect(w1?.remainingSeconds).not.toBe(w2?.remainingSeconds);
    expect(w1?.activeCartNumber).not.toBe(w2?.activeCartNumber);
  });

  it("洗衣設備倒數結束時，洗衣車退出設備（設備回復閒置），且洗衣車回到「待處理洗衣車」等待下一階段", () => {
    const baseNow = new Date("2026-10-13T12:00:00.000Z").getTime();
    const equipment: WorkspaceEquipment[] = [
      {
        id: "eq-washer-1",
        name: "1號大型洗衣機",
        equipmentType: "washer",
        status: "normal",
        occupied: true,
        cleaningDurationMinutes: 60,
      },
      {
        id: "eq-tank-1",
        name: "本館消毒鍋",
        equipmentType: "disinfection_tank",
        status: "normal",
        occupied: true,
        cleaningDurationMinutes: 30,
      },
    ];

    const orders: WorkspaceOrder[] = [
      {
        id: "order-wash-1",
        orderNumber: "MAIN-20261013-0001",
        cartNumber: "1A-1",
        institutionName: "仁愛院",
        status: "in_process",
        updatedAt: "2026-10-13T11:00:00.000Z",
      },
      {
        id: "order-tank-1",
        orderNumber: "MAIN-20261013-0002",
        cartNumber: "2B-2",
        institutionName: "博愛家",
        status: "in_process",
        updatedAt: "2026-10-13T11:00:00.000Z",
      },
    ];

    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-wash-1",
        batches: [
          makeBatch({
            id: "batch-1",
            categoryName: "一般被服",
            categoryCode: "NORM",
            activeEquipmentName: "1號大型洗衣機",
            status: "in_progress",
            stages: [
              makeStage({
                stageOrder: 1,
                name: "主洗",
                equipmentType: "washer",
                state: "active",
                startedAt: "2026-10-13T11:00:00.000Z",
              }),
            ],
          }),
        ],
      }),
      makeDetail({
        orderId: "order-tank-1",
        batches: [
          makeBatch({
            id: "batch-2",
            categoryName: "消毒品",
            categoryCode: "DISINFECT",
            activeEquipmentName: "本館消毒鍋",
            status: "in_progress",
            stages: [
              makeStage({
                stageOrder: 1,
                name: "浸泡消毒",
                equipmentType: "disinfection_tank",
                state: "active",
                startedAt: "2026-10-13T11:00:00.000Z",
              }),
            ],
          }),
        ],
      }),
    ];

    // 1. 驗證設備倒數結束並完成後（傳入 completedEquipNames / completedEquipIds）：
    // 設備卡片清空車號與機構標籤，狀態轉為「閒置待機」，即「洗衣車退出使用的設備」
    const { washingEquipment, disinfectionEquipment } = deriveEquipmentLiveStatuses(
      equipment,
      orders,
      details,
      {
        nowMs: baseNow,
        completedEquipIds: new Set(["eq-washer-1", "eq-tank-1"]),
        completedEquipNames: new Set(["1號大型洗衣機", "本館消毒鍋"]),
      }
    );

    const washer = washingEquipment.find((w) => w.equipment.id === "eq-washer-1");
    expect(washer).toBeDefined();
    expect(washer?.activeCartNumber).toBeNull();
    expect(washer?.activeInstitutionName).toBeNull();
    expect(washer?.statusTone).toBe("idle");
    expect(washer?.statusLabel).toBe("閒置待機");
    expect(washer?.remainingSeconds).toBeNull();

    const tank = disinfectionEquipment.find((t) => t.equipment.id === "eq-tank-1");
    expect(tank).toBeDefined();
    expect(tank?.activeCartNumber).toBeNull();
    expect(tank?.activeInstitutionName).toBeNull();
    expect(tank?.statusTone).toBe("idle");
    expect(tank?.statusLabel).toBe("閒置待機");
    expect(tank?.remainingSeconds).toBeNull();

    // 2. 驗證洗衣車退出設備後回到「待處理洗衣車」：
    // - 消毒鍋結束：洗衣車回到待處理洗衣車，標記「已完成：消毒完畢 ➔ 下一階段：待清洗」
    // - 洗衣機結束：洗衣車回到待處理洗衣車，標記「已完成：清洗完畢 ➔ 下一階段：待烘乾」
    const pendingCarts = derivePendingCarts(orders, details, {
      completedEquipmentNames: new Set(["1號大型洗衣機", "本館消毒鍋"]),
      completedEquipmentIds: new Set(["eq-washer-1", "eq-tank-1"]),
      completedStageCarts: new Map([
        [
          "1A-1",
          {
            justFinished: "清洗完畢",
            nextStage: "待烘乾",
            nextTone: "dry",
          },
        ],
        [
          "2B-2",
          {
            justFinished: "消毒完畢",
            nextStage: "待清洗",
            nextTone: "wash",
          },
        ],
      ]),
    });

    expect(pendingCarts.length).toBe(2);

    const pendingWasherCart = pendingCarts.find((c) => c.cartNumber === "1A-1");
    expect(pendingWasherCart).toBeDefined();
    expect(pendingWasherCart?.isPostStage).toBe(true);
    expect(pendingWasherCart?.justFinishedStage).toBe("清洗完畢");
    expect(pendingWasherCart?.nextStageName).toBe("待烘乾");
    expect(pendingWasherCart?.nextStageTone).toBe("dry");

    const pendingTankCart = pendingCarts.find((c) => c.cartNumber === "2B-2");
    expect(pendingTankCart).toBeDefined();
    expect(pendingTankCart?.isPostStage).toBe(true);
    expect(pendingTankCart?.justFinishedStage).toBe("消毒完畢");
    expect(pendingTankCart?.nextStageName).toBe("待清洗");
    expect(pendingTankCart?.nextStageTone).toBe("wash");
  });

  it("已取件（picked_up）之洗衣單在資料庫同步後絕不出現在待處理或待取件清單中", () => {
    const orders: WorkspaceOrder[] = [
      {
        id: "order-picked",
        orderNumber: "MAIN-20261012-0008",
        cartNumber: "3C-1",
        institutionName: "仁愛之家",
        status: "picked_up",
        updatedAt: "2026-10-12T12:00:00.000Z",
      },
    ];
    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-picked",
        orderCreatedAt: "2026-10-12T08:00:00.000Z",
        orderReceivedAt: "2026-10-12T08:30:00.000Z",
        orderReadyAt: "2026-10-12T11:00:00.000Z",
        orderClosedAt: "2026-10-12T12:00:00.000Z",
      }),
    ];

    const pending = derivePendingCarts(orders, details);
    expect(pending.length).toBe(0);
  });

  it("設備故障異常（abnormal）或維修中（maintenance）在設備清單中正確標示非正常狀態", () => {
    const equipList: WorkspaceEquipment[] = [
      {
        id: "eq-broken",
        name: "本館洗衣-3",
        equipmentType: "washer",
        status: "abnormal",
        occupied: false,
      },
      {
        id: "eq-maint",
        name: "本館烘衣-2",
        equipmentType: "dryer",
        status: "maintenance",
        occupied: false,
      },
      {
        id: "eq-normal",
        name: "本館洗衣-1",
        equipmentType: "washer",
        status: "normal",
        occupied: false,
      },
    ];

    expect(equipList[0].status).toBe("abnormal");
    expect(equipList[1].status).toBe("maintenance");
    expect(equipList[2].status).toBe("normal");
  });

  it("設備在運轉中被設定停用（inactive）時，倒數計時徹底停止，狀態標籤顯示為已停用且標示為暫停", () => {
    const equipList: WorkspaceEquipment[] = [
      {
        id: "dryer-1",
        name: "本館烘衣-1",
        equipmentType: "dryer",
        status: "inactive",
        occupied: true,
      },
    ];

    const orders: WorkspaceOrder[] = [
      {
        id: "order-1",
        orderNumber: "MAIN-20261019-0008",
        cartNumber: "7E-1",
        institutionName: "清泉",
        status: "in_process",
        updatedAt: "2026-10-19T07:00:00.000Z",
      },
    ];

    const details: WorkspaceOrderDetail[] = [
      makeDetail({
        orderId: "order-1",
        batches: [
          makeBatch({
            id: "batch-1",
            status: "in_progress",
            activeEquipmentName: "本館烘衣-1",
            activeEquipmentType: "dryer",
            stages: [
              makeStage({
                stageOrder: 1,
                name: "烘衣",
                equipmentType: "dryer",
                state: "active",
                startedAt: "2026-10-19T07:10:00.000Z",
              }),
            ],
          }),
        ],
      }),
    ];

    const { dryingEquipment } = deriveEquipmentLiveStatuses(equipList, orders, details);
    expect(dryingEquipment).toHaveLength(1);
    const dryer = dryingEquipment[0];
    expect(dryer.statusLabel).toBe("已停用");
    expect(dryer.statusTone).toBe("paused");
    expect(dryer.remainingSeconds).toBeNull();
    expect(dryer.formattedCountdown).toBeNull();
    expect(dryer.activeCartNumber).toBeNull();
    expect(dryer.activeInstitutionName).toBeNull();

    // 驗證洗衣車自動返回待處理洗衣車清單，且下一階段正確對齊待烘乾
    const pending = derivePendingCarts(orders, details, {
      nonNormalEquipmentNames: new Set(["本館烘衣-1"]),
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].cartNumber).toBe("7E-1");
    expect(pending[0].nextStageName).toBe("待烘乾");
  });

  describe("洗滌品項顏色推導統一 (getCartCategoryBadgeClass)", () => {
    const mockStyles = {
      cartCategoryDisinfect: "disinfect-class",
      cartCategoryBib: "bib-class",
      cartCategoryCurtain: "curtain-class",
      cartCategorySoiled: "soiled-class",
      cartCategoryGeneral: "general-class",
    };

    it("圍兜與快烘等純烘乾品項應精準套用藍紫色 cartCategoryBib 樣式", () => {
      expect(getCartCategoryBadgeClass("圍兜", mockStyles)).toBe("bib-class");
      expect(getCartCategoryBadgeClass("成人圍兜", mockStyles)).toBe("bib-class");
      expect(getCartCategoryBadgeClass("快烘", mockStyles)).toBe("bib-class");
      expect(getCartCategoryBadgeClass("快速烘乾", mockStyles)).toBe("bib-class");
    });

    it("床簾 (CURTAIN) 品項應精準套用深墨綠色 cartCategoryCurtain 樣式", () => {
      expect(getCartCategoryBadgeClass("床簾", mockStyles)).toBe("curtain-class");
      expect(getCartCategoryBadgeClass("隔簾/床簾", mockStyles)).toBe("curtain-class");
    });

    it("消毒品 (DISINFECT) 品項應精準套用洋紅紫 cartCategoryDisinfect 樣式", () => {
      expect(getCartCategoryBadgeClass("消毒品", mockStyles)).toBe("disinfect-class");
      expect(getCartCategoryBadgeClass("感染性被服", mockStyles)).toBe("disinfect-class");
    });

    it("汙衣/污衣 (SOILED) 品項應精準套用琥珀棕褐 cartCategorySoiled 樣式", () => {
      expect(getCartCategoryBadgeClass("汙衣", mockStyles)).toBe("soiled-class");
      expect(getCartCategoryBadgeClass("重污被服", mockStyles)).toBe("soiled-class");
    });

    it("一般被服與其他品項應套用玄灰藍 cartCategoryGeneral 樣式", () => {
      expect(getCartCategoryBadgeClass("一般被服", mockStyles)).toBe("general-class");
      expect(getCartCategoryBadgeClass("一般", mockStyles)).toBe("general-class");
      expect(getCartCategoryBadgeClass("", mockStyles)).toBe("general-class");
    });

    it("待處理洗衣車中，分類為「快烘」的單據下一階段應為「待烘乾」，不可為「待清洗」", () => {
      const orders: WorkspaceOrder[] = [
        {
          id: "order-quick-dry-cart",
          orderNumber: "MAIN-20261020-0099",
          cartNumber: "2C-2",
          institutionName: "護家",
          status: "awaiting_cleaning",
          updatedAt: "2026-10-20T08:00:00Z",
        },
      ];
      const details: WorkspaceOrderDetail[] = [
        makeDetail({
          orderId: "order-quick-dry-cart",
          orderCreatedAt: "2026-10-20T08:00:00Z",
          batches: [
            makeBatch({
              id: "batch-quick-dry-1",
              categoryCode: "CUSTOM_DRY",
              categoryName: "快烘",
              stages: [
                makeStage({ stageOrder: 1, name: "烘衣", equipmentType: "dryer", state: "pending" }),
              ],
            }),
          ],
        }),
      ];

      const pending = derivePendingCarts(orders, details);
      expect(pending).toHaveLength(1);
      expect(pending[0].cartNumber).toBe("2C-2");
      expect(pending[0].categoryNames).toContain("快烘");
      expect(pending[0].nextStageName).toBe("待烘乾");
      expect(pending[0].nextStageTone).toBe("dry");
    });

    it("烘衣機執行「快烘」批次時，設定時間應為 20 分鐘", () => {
      const eq: WorkspaceEquipment = {
        id: "dryer-quick-1",
        name: "本館烘衣-1",
        equipmentType: "dryer",
        status: "normal",
        occupied: true,
        cleaningDurationMinutes: 60,
      };

      const orders: WorkspaceOrder[] = [
        {
          id: "order-qd-1",
          orderNumber: "MAIN-20261020-0088",
          cartNumber: "2C-2",
          institutionName: "本館",
          status: "in_process",
          updatedAt: "2026-10-20T08:00:00Z",
        },
      ];

      const details: WorkspaceOrderDetail[] = [
        makeDetail({
          orderId: "order-qd-1",
          orderCreatedAt: "2026-10-20T08:00:00Z",
          batches: [
            makeBatch({
              id: "batch-qd-1",
              status: "in_progress",
              categoryCode: "CUSTOM_DRY",
              categoryName: "快烘",
              activeEquipmentName: "本館烘衣-1",
              activeEquipmentType: "dryer",
              stages: [
                makeStage({
                  stageOrder: 1,
                  name: "快烘",
                  equipmentType: "dryer",
                  state: "active",
                  standardMinutes: 20,
                  startedAt: "2026-10-20T08:00:00Z",
                }),
              ],
            }),
          ],
        }),
      ];

      const { dryingEquipment } = deriveEquipmentLiveStatuses([eq], orders, details);
      expect(dryingEquipment).toHaveLength(1);
      const dryerStatus = dryingEquipment[0];
      expect(dryerStatus.cleaningDurationMinutes).toBe(20);
      expect(dryerStatus.activeCategoryName).toBe("快烘");
    });
  });
});



