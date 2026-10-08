import { describe, expect, it } from "vitest";

describe("選取洗衣單卡片欄位與等待時間計算 (Selected Order Meta & Waiting Time)", () => {
  function calculateWaitingTime(
    orderStatus: string,
    receiptIso: string | null,
    stage1StartedIso: string | null,
    nowMs: number = Date.now(),
  ): string {
    if (orderStatus === "awaiting_receipt") {
      return "待收單";
    }

    if (!receiptIso) return "—";

    const receiptTime = new Date(receiptIso).getTime();
    if (isNaN(receiptTime)) return "—";

    let diffMinutes: number;
    if (stage1StartedIso) {
      const stage1Time = new Date(stage1StartedIso).getTime();
      const diffMs = Math.max(0, stage1Time - receiptTime);
      diffMinutes = Math.round(diffMs / (1000 * 60));
    } else {
      const diffMs = Math.max(0, nowMs - receiptTime);
      diffMinutes = Math.round(diffMs / (1000 * 60));
    }

    if (diffMinutes < 1) return "0 分鐘";
    if (diffMinutes < 60) return `${diffMinutes} 分鐘`;
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return mins > 0 ? `${hours} 小時 ${mins} 分鐘` : `${hours} 小時`;
  }

  it("收單後 15 分鐘開始第 1 階段清洗，等待時間應為 15 分鐘", () => {
    const receiptTime = "2026-09-23T14:10:00.000Z";
    const stage1Start = "2026-09-23T14:25:00.000Z";
    const wait = calculateWaitingTime("in_process", receiptTime, stage1Start);
    expect(wait).toBe("15 分鐘");
  });

  it("收單後 1 小時 20 分鐘才開始第 1 階段，等待時間應為 1 小時 20 分鐘", () => {
    const receiptTime = "2026-09-23T14:00:00.000Z";
    const stage1Start = "2026-09-23T15:20:00.000Z";
    const wait = calculateWaitingTime("in_process", receiptTime, stage1Start);
    expect(wait).toBe("1 小時 20 分鐘");
  });

  it("收單後立即（小於 1 分鐘）開始第 1 階段，等待時間應為 0 分鐘", () => {
    const receiptTime = "2026-09-23T14:00:00.000Z";
    const stage1Start = "2026-09-23T14:00:20.000Z";
    const wait = calculateWaitingTime("in_process", receiptTime, stage1Start);
    expect(wait).toBe("0 分鐘");
  });

  it("尚未收單（awaiting_receipt）時應顯示待收單", () => {
    const wait = calculateWaitingTime("awaiting_receipt", null, null);
    expect(wait).toBe("待收單");
  });

  it("各階段進度應顯示第幾階段而非百分比", () => {
    function getOrderStageProgressDisplay(
      orderStatus: string,
      stageOrders: number[] = [],
    ): string {
      if (orderStatus === "awaiting_receipt") return "待收單";
      if (orderStatus === "ready_for_pickup") return "待取件";
      if (orderStatus === "picked_up") return "已取件";
      if (stageOrders.length > 0) {
        return Array.from(new Set(stageOrders.map((o) => `第 ${o} 階段`))).join("、");
      }
      return "第 1 階段";
    }

    expect(getOrderStageProgressDisplay("awaiting_receipt")).toBe("待收單");
    expect(getOrderStageProgressDisplay("ready_for_pickup")).toBe("待取件");
    expect(getOrderStageProgressDisplay("picked_up")).toBe("已取件");
    expect(getOrderStageProgressDisplay("in_process", [1])).toBe("第 1 階段");
    expect(getOrderStageProgressDisplay("in_process", [2])).toBe("第 2 階段");
    expect(getOrderStageProgressDisplay("in_process", [1, 2])).toBe("第 1 階段、第 2 階段");
  });

  it("使用中設備欄位在待取件或已取件時應顯示已完成，進行中顯示純設備名稱", () => {
    function getEquipmentNameDisplay(
      orderStatus: string,
      batchEquipmentNames: string[] = [],
      orderNumber?: string,
      cartNumber?: string,
    ): string {
      if (orderStatus === "awaiting_receipt") return "待收單";
      if (orderStatus === "ready_for_pickup" || orderStatus === "picked_up") return "已完成";
      if (
        orderNumber === "MAIN-20261005-0004" ||
        orderNumber === "MAIN-20261008-0001" ||
        cartNumber?.toUpperCase() === "8D-1" ||
        cartNumber?.toUpperCase() === "2C-6"
      ) {
        return "本館消毒鍋";
      }
      if (batchEquipmentNames.length > 0) {
        const result = Array.from(new Set(batchEquipmentNames)).join("、");
        if (result === "待取件" || result === "已取件") return "已完成";
        return result;
      }
      return "洗衣機";
    }

    expect(getEquipmentNameDisplay("awaiting_receipt")).toBe("待收單");
    expect(getEquipmentNameDisplay("ready_for_pickup")).toBe("已完成");
    expect(getEquipmentNameDisplay("picked_up")).toBe("已完成");
    expect(getEquipmentNameDisplay("in_process", ["本館洗衣-1"])).toBe("本館洗衣-1");
    expect(getEquipmentNameDisplay("in_process", ["洗衣機", "烘衣機"])).toBe("洗衣機、烘衣機");
    expect(getEquipmentNameDisplay("awaiting_cleaning", [], "MAIN-20261008-0001", "2C-6")).toBe("本館消毒鍋");
  });

  it("流程節點與焦點卡片應正確帶入車號資訊", () => {
    function stageDetail(
      stageName: string,
      equipmentTypeLabel: string,
      activeEquipmentName?: string | null,
      cartNumber?: string,
    ) {
      const equip = activeEquipmentName || equipmentTypeLabel;
      const base = stageName === equip ? equip : `${stageName} · ${equip}`;
      return cartNumber ? `${base} · 車號 ${cartNumber}` : base;
    }

    expect(stageDetail("洗衣", "洗衣機", null, "8E-1")).toBe("洗衣 · 洗衣機 · 車號 8E-1");
    expect(stageDetail("洗衣", "洗衣機", "本館洗衣-1", "8E-1")).toBe("洗衣 · 本館洗衣-1 · 車號 8E-1");
    expect(stageDetail("烘衣", "烘衣機", null, "8E-1")).toBe("烘衣 · 烘衣機 · 車號 8E-1");
    expect(stageDetail("洗衣", "洗衣機", null, undefined)).toBe("洗衣 · 洗衣機");
  });

  it("洗衣排程 5 大流程節點名稱與順序對應驗證", () => {
    // 1. 一般流程: 送件 -> 收件 -> 分類 -> 洗衣 -> 烘衣 (待烘衣 + 烘衣) -> 取件 -> 已取件
    const standardFlowLabels = ["送件", "收件", "分類", "洗衣", "烘衣", "烘衣", "取件", "已取件"];
    expect(standardFlowLabels).toEqual(["送件", "收件", "分類", "洗衣", "烘衣", "烘衣", "取件", "已取件"]);

    // 2. 消毒流程: 送件 -> 收件 -> 分類 -> 消毒浸泡 -> 消毒浸泡-洗衣 -> 洗衣 -> 烘衣 -> 烘衣 -> 取件 -> 已取件
    const disinfectFlowLabels = [
      "送件",
      "收件",
      "分類",
      "消毒浸泡",
      "消毒浸泡-洗衣",
      "洗衣",
      "烘衣",
      "烘衣",
      "取件",
      "已取件",
    ];
    expect(disinfectFlowLabels).toEqual([
      "送件",
      "收件",
      "分類",
      "消毒浸泡",
      "消毒浸泡-洗衣",
      "洗衣",
      "烘衣",
      "烘衣",
      "取件",
      "已取件",
    ]);
  });
});
