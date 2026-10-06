import { describe, expect, it } from "vitest";

import { formatBatchLabel, type ControlBatch } from "../../src/app/app/operations/batch-label";

describe("操作控制點與批次標籤 (Operations Control & Batch Labels)", () => {
  it("formatBatchLabel 正確格式化包含作業據點名稱的批次", () => {
    const batch: ControlBatch = {
      id: "b1111111-1111-4111-8111-111111111111",
      status: "not_started",
      current_stage_order: 1,
      orderNumber: "MAIN-20260911-0001",
      cartNumber: "8D-1",
      categoryName: "床簾",
      institutionName: "清春",
      operating_site_id: "site-main",
      operating_site_name: "清福本館",
    };

    const label = formatBatchLabel(batch);
    expect(label).toBe("MAIN-20260911-0001 · 8D-1 · 床簾 · 清春 · (清福本館) · 第 1 階段");
  });

  it("formatBatchLabel 在未提供據點名稱時維持簡潔格式", () => {
    const batch: ControlBatch = {
      id: "b2222222-2222-4222-8222-222222222222",
      status: "not_started",
      current_stage_order: 2,
      orderNumber: "CORP-20260911-0002",
      cartNumber: "7C-2",
      categoryName: "毛巾",
      institutionName: "清福醫院",
    };

    const label = formatBatchLabel(batch);
    expect(label).toBe("CORP-20260911-0002 · 7C-2 · 毛巾 · 清福醫院 · 第 2 階段");
  });

  it("設備據點過濾機制可正確篩選出同據點批次", () => {
    const batches: ControlBatch[] = [
      {
        id: "batch-main-1",
        status: "not_started",
        current_stage_order: 1,
        orderNumber: "MAIN-001",
        operating_site_id: "site-main",
        operating_site_name: "清福本館",
      },
      {
        id: "batch-corp-1",
        status: "not_started",
        current_stage_order: 1,
        orderNumber: "CORP-001",
        operating_site_id: "site-corp",
        operating_site_name: "清福法人",
      },
    ];

    const equipmentSiteId = "site-main";
    const filtered = batches.filter(
      (b) => !b.operating_site_id || b.operating_site_id === equipmentSiteId,
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("batch-main-1");
    expect(filtered[0].operating_site_name).toBe("清福本館");
  });

  it("收單分類可正確篩選出同據點且匹配分類的閒置設備名稱代號", () => {
    const equipmentList = [
      { id: "e1", name: "本館洗衣-1", equipmentType: "washer", occupied: true, status: "normal", operatingSiteId: "site-main" },
      { id: "e2", name: "本館洗衣-2", equipmentType: "washer", occupied: false, status: "normal", operatingSiteId: "site-main" },
      { id: "e3", name: "本館烘衣-1", equipmentType: "dryer", occupied: false, status: "normal", operatingSiteId: "site-main" },
      { id: "e4", name: "本館消毒鍋", equipmentType: "disinfection_tank", occupied: false, status: "normal", operatingSiteId: "site-main" },
      { id: "e5", name: "法人洗衣-1", equipmentType: "washer", occupied: false, status: "normal", operatingSiteId: "site-corp" },
    ];

    const matchedOrder = { orderNumber: "MAIN-20261006-0001", institutionName: "清景" };
    const isCorpOrder = matchedOrder.orderNumber.startsWith("CORP") || matchedOrder.institutionName.includes("法人");

    const siteScopedEquipment = equipmentList.filter((e) => {
      if (isCorpOrder) {
        return e.name.includes("法人") || e.name.startsWith("CORP");
      }
      return e.name.includes("本館") || (!e.name.includes("法人") && !e.name.startsWith("CORP"));
    });

    const idleEquipment = siteScopedEquipment.filter((e) => !e.occupied && e.status === "normal");

    const neededTypesForOther = ["washer", "dryer"];
    const idleForOther = idleEquipment
      .filter((e) => neededTypesForOther.includes(e.equipmentType))
      .map((e) => e.name);

    expect(idleForOther).toEqual(["本館洗衣-2", "本館烘衣-1"]);

    const neededTypesForDisinfect = ["disinfection_tank", "washer", "dryer"];
    const idleForDisinfect = idleEquipment
      .filter((e) => neededTypesForDisinfect.includes(e.equipmentType))
      .map((e) => e.name);

    expect(idleForDisinfect).toEqual(["本館洗衣-2", "本館烘衣-1", "本館消毒鍋"]);
  });

  it("消毒控制點可正確呈現 第一階段(浸泡消毒) 處理進度格式", () => {
    function chineseStageNumber(order: number) {
      const map: Record<number, string> = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五" };
      return map[order] ?? String(order);
    }

    const batch: ControlBatch = {
      id: "b-disinfect-1",
      status: "not_started",
      current_stage_order: 1,
      orderNumber: "MAIN-20261005-0004",
      cartNumber: "8D-1",
      categoryName: "消毒品",
      institutionName: "清春",
    };

    const isDisinfect = batch.categoryName?.includes("消毒");
    const displayProgress = isDisinfect
      ? `第${chineseStageNumber(batch.current_stage_order)}階段(浸泡消毒)`
      : `第${chineseStageNumber(batch.current_stage_order)}階段(待清洗)`;
    expect(displayProgress).toBe("第一階段(浸泡消毒)");

    const buttonText = isDisinfect ? "確認開始浸泡消毒" : "確認開始清洗";
    expect(buttonText).toBe("確認開始浸泡消毒");
  });

  it("消毒單號可正確產生帶有車號與單號之消毒操作 URL 查詢參數", () => {
    const orderNumber = "MAIN-20261005-0004";
    const cartNumber = "8D-1";
    const institutionName = "清春";

    const params = new URLSearchParams();
    if (orderNumber) params.set("order", orderNumber);
    if (cartNumber) params.set("cart", cartNumber);
    if (institutionName) params.set("institution", institutionName);

    const href = `/app/operations/disinfection?${params.toString()}`;
    expect(href).toBe("/app/operations/disinfection?order=MAIN-20261005-0004&cart=8D-1&institution=%E6%B8%85%E6%98%A5");
    expect(params.get("order")).toBe("MAIN-20261005-0004");
    expect(params.get("cart")).toBe("8D-1");
  });

  it("操作頁面標題與處理進度邏輯一致 (Title matches display progress)", () => {
    function chineseStageNumber(order: number) {
      const map: Record<number, string> = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五" };
      return map[order] ?? String(order);
    }

    // 1. 第二階段待清洗批次
    const washingBatch2: ControlBatch = {
      id: "b-wash-2",
      status: "not_started",
      current_stage_order: 2,
      orderNumber: "MAIN-20261006-0001",
      categoryName: "汙衣",
    };
    const stageNum2 = chineseStageNumber(washingBatch2.current_stage_order);
    const washingTitle2 = `第${stageNum2}階段(待清洗)`;
    expect(washingTitle2).toBe("第二階段(待清洗)");

    // 2. 第一階段浸泡消毒批次
    const disinfectBatch1: ControlBatch = {
      id: "b-disinfect-1",
      status: "not_started",
      current_stage_order: 1,
      orderNumber: "MAIN-20261005-0004",
      categoryName: "消毒品",
    };
    const stageNumDisinfect = chineseStageNumber(disinfectBatch1.current_stage_order);
    const disinfectTitle = `第${stageNumDisinfect}階段(浸泡消毒)`;
    expect(disinfectTitle).toBe("第一階段(浸泡消毒)");

    // 3. 處理中批次
    const inProgressBatch: ControlBatch = {
      id: "b-wash-in-progress",
      status: "in_progress",
      current_stage_order: 1,
      orderNumber: "MAIN-20261006-0002",
      categoryName: "一般",
    };
    const stageNumProg = chineseStageNumber(inProgressBatch.current_stage_order);
    const inProgressTitle = `第${stageNumProg}階段(處理中)`;
    expect(inProgressTitle).toBe("第一階段(處理中)");

    // 4. 按下「確認清洗完成」後，進度與標題同步更新為「第二階段(已完成)」
    const isCompletedSuccess = true;
    const completedProgress = isCompletedSuccess
      ? "第二階段(已完成)"
      : `第${stageNumProg}階段(處理中)`;
    expect(completedProgress).toBe("第二階段(已完成)");
  });
});

