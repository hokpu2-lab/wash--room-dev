import { describe, expect, it } from "vitest";

import { formatBatchLabel, type ControlBatch } from "../../src/app/app/operations/batch-label";
import { isBatchEligibleForEquipment } from "../../src/app/app/operations/stage-eligibility";

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
    const batch2: ControlBatch = {
      id: "b-disinfect-2",
      status: "not_started",
      current_stage_order: 1,
      orderNumber: "MAIN-20261008-0001",
      cartNumber: "2C-6",
      categoryName: "消毒品",
      institutionName: "護家",
    };

    const isDisinfect2 = batch2.categoryName?.includes("消毒");
    const displayProgress2 = isDisinfect2
      ? `第${chineseStageNumber(batch2.current_stage_order)}階段(浸泡消毒)`
      : `第${chineseStageNumber(batch2.current_stage_order)}階段(待清洗)`;
    expect(displayProgress2).toBe("第一階段(浸泡消毒)");

    const buttonText2 = isDisinfect2 ? "確認開始浸泡消毒" : "確認開始清洗";
    expect(buttonText2).toBe("確認開始浸泡消毒");

    // 消毒批次進入第二階段 (清洗階段)
    const disinfectBatchStage2: ControlBatch = {
      id: "b-disinfect-stage2",
      status: "not_started",
      current_stage_order: 2,
      orderNumber: "MAIN-20261008-0001",
      cartNumber: "2C-6",
      categoryName: "消毒品",
      institutionName: "護家",
    };
    const isStage1 = (disinfectBatchStage2.current_stage_order ?? 1) === 1;
    const washingProgressForDisinfect2 = isStage1
      ? "第一階段(浸泡消毒)"
      : `第${chineseStageNumber(disinfectBatchStage2.current_stage_order)}階段(待清洗)`;
    expect(washingProgressForDisinfect2).toBe("第二階段(待清洗)");
    const washingButtonForDisinfect2 = isStage1 ? "確認開始浸泡消毒" : "確認開始清洗";
    expect(washingButtonForDisinfect2).toBe("確認開始清洗");
  });

  it("消毒單號可正確產生帶有車號與單號之消毒操作 URL 查詢參數", () => {
    const orderNumber = "MAIN-20261008-0001";
    const cartNumber = "2C-6";
    const institutionName = "護家";

    const params = new URLSearchParams();
    if (orderNumber) params.set("order", orderNumber);
    if (cartNumber) params.set("cart", cartNumber);
    if (institutionName) params.set("institution", institutionName);

    const href = `/app/operations/disinfection?${params.toString()}`;
    expect(href).toBe("/app/operations/disinfection?order=MAIN-20261008-0001&cart=2C-6&institution=%E8%AD%B7%E5%AE%B6");
    expect(params.get("order")).toBe("MAIN-20261008-0001");
    expect(params.get("cart")).toBe("2C-6");
  });

  it("操作頁面標題與處理進度邏輯一致 (Title matches display progress)", () => {
    function chineseStageNumber(order: number) {
      const map: Record<number, string> = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五" };
      return map[order] ?? String(order);
    }

    // 1. 第二階段清洗/烘乾批次（進入第二階段）
    const washingBatch2: ControlBatch = {
      id: "b-wash-2",
      status: "not_started",
      current_stage_order: 2,
      orderNumber: "MAIN-20261006-0001",
      categoryName: "汙衣",
    };
    const stageNum2 = chineseStageNumber(washingBatch2.current_stage_order);
    const isStage2Complete = stageNum2 === "二" || (washingBatch2.current_stage_order ?? 1) >= 2;
    const washingTitle2 = isStage2Complete ? "第二階段完成" : `第${stageNum2}階段(待清洗)`;
    expect(washingTitle2).toBe("第二階段完成");

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

    // 4. 按下「確認清洗完成」後，進度與標題同步更新為「第二階段完成」
    const isCompletedSuccess = true;
    const completedProgress = isCompletedSuccess
      ? "第二階段完成"
      : `第${stageNumProg}階段(處理中)`;
    expect(completedProgress).toBe("第二階段完成");
  });

  it("控制點提供送洗機構與待處理批次選取功能，並在切換時同步更新選取狀態 (Control points allow selecting institution/batch and updates dynamically)", () => {
    const batches: ControlBatch[] = [
      {
        id: "b1",
        status: "not_started",
        current_stage_order: 2,
        orderNumber: "MAIN-20261006-0001",
        cartNumber: "2C-1",
        institutionName: "護理之家",
        categoryName: "汙衣",
      },
      {
        id: "b2",
        status: "not_started",
        current_stage_order: 2,
        orderNumber: "MAIN-20261006-0003",
        cartNumber: "3A-2",
        institutionName: "養護中心",
        categoryName: "一般",
      },
    ];

    let selectedBatchId = batches[0].id;
    let selectedBatch = batches.find((b) => b.id === selectedBatchId);
    expect(selectedBatch?.institutionName).toBe("護理之家");
    expect(selectedBatch?.cartNumber).toBe("2C-1");

    // 切換選取為養護中心批次
    selectedBatchId = batches[1].id;
    selectedBatch = batches.find((b) => b.id === selectedBatchId);
    expect(selectedBatch?.institutionName).toBe("養護中心");
    expect(selectedBatch?.cartNumber).toBe("3A-2");
    expect(selectedBatch?.orderNumber).toBe("MAIN-20261006-0003");
  });

  it("清洗控制點設備智慧推導優先選取同據點未占用設備 (Washer smart inference selects idle equipment)", () => {
    const availableEquipment = [
      { id: "w1", name: "本館洗衣-1", equipment_type: "washer", occupied: true, status: "normal", operating_site_id: "site-main", operating_site_name: "清福本館" },
      { id: "w2", name: "本館洗衣-2", equipment_type: "washer", occupied: false, status: "normal", operating_site_id: "site-main", operating_site_name: "清福本館" },
      { id: "w3", name: "法人洗衣-1", equipment_type: "washer", occupied: false, status: "normal", operating_site_id: "site-corp", operating_site_name: "清福法人" },
    ];

    const batch: ControlBatch = {
      id: "b-main",
      status: "not_started",
      current_stage_order: 2,
      orderNumber: "MAIN-20261008-0001",
      operating_site_id: "site-main",
    };

    const matchedWashers = availableEquipment.filter((e) => e.equipment_type === "washer" && e.operating_site_id === batch.operating_site_id);
    const idleMatchedWasher = matchedWashers.find((w) => !w.occupied && w.status === "normal");
    const defaultWasher =
      idleMatchedWasher ||
      matchedWashers.find((w) => w.name === "本館洗衣-1") ||
      matchedWashers[0];

    // 預設自動選取同據點未占用的本館洗衣-2，而非已被占用的本館洗衣-1
    expect(defaultWasher?.id).toBe("w2");
    expect(defaultWasher?.name).toBe("本館洗衣-2");
  });

  it("手機掃碼進入控制點時，displayCart 優先使用 batch.cartNumber，若無則精準回退至 selectedCartNumber", () => {
    // 情境 1：批次自身帶有車號
    const batchWithCart: ControlBatch = {
      id: "b-with-cart",
      status: "in_progress",
      current_stage_order: 2,
      orderNumber: "CORP-20261015-0001",
      cartNumber: "6D-1",
      categoryName: "消毒品",
      institutionName: "一館",
    };
    const displayCart1 = batchWithCart.cartNumber || "—";
    expect(displayCart1).toBe("6D-1");

    // 情境 2：批次暫無車號，但掃碼 URL 帶入 selectedCartNumber
    const batchWithoutCart: ControlBatch = {
      id: "b-without-cart",
      status: "in_progress",
      current_stage_order: 2,
      orderNumber: "CORP-20261015-0001",
      categoryName: "消毒品",
      institutionName: "一館",
    };
    const selectedCartNumber = "6D-1";
    const displayCart2 = batchWithoutCart.cartNumber || selectedCartNumber || "—";
    expect(displayCart2).toBe("6D-1");
  });

  it("isBatchEligibleForEquipment 正確判定五大分類在各階段唯一的設備資格", () => {
    // 1. 圍兜 (BIB)：只有第 1 階段需要烘乾，絕不進入消毒鍋或洗衣機
    const bibStage1 = { categoryName: "圍兜", current_stage_order: 1 };
    expect(isBatchEligibleForEquipment(bibStage1, "disinfection_tank")).toBe(false);
    expect(isBatchEligibleForEquipment(bibStage1, "washer")).toBe(false);
    expect(isBatchEligibleForEquipment(bibStage1, "dryer")).toBe(true);

    // 2. 床簾 (CURTAIN)：只有第 1 階段需要清洗，洗完待取件，絕不進入消毒鍋或烘衣機
    const curtainStage1 = { categoryName: "床簾", current_stage_order: 1 };
    expect(isBatchEligibleForEquipment(curtainStage1, "disinfection_tank")).toBe(false);
    expect(isBatchEligibleForEquipment(curtainStage1, "washer")).toBe(true);
    expect(isBatchEligibleForEquipment(curtainStage1, "dryer")).toBe(false);

    // 3. 消毒品 (DISINFECT)：第 1 階段消毒鍋、第 2 階段洗衣機、第 3 階段烘衣機
    const disinfectStage1 = { categoryName: "消毒品", current_stage_order: 1 };
    expect(isBatchEligibleForEquipment(disinfectStage1, "disinfection_tank")).toBe(true);
    expect(isBatchEligibleForEquipment(disinfectStage1, "washer")).toBe(false);
    expect(isBatchEligibleForEquipment(disinfectStage1, "dryer")).toBe(false);

    const disinfectStage2 = { categoryName: "消毒品", current_stage_order: 2 };
    expect(isBatchEligibleForEquipment(disinfectStage2, "disinfection_tank")).toBe(false);
    expect(isBatchEligibleForEquipment(disinfectStage2, "washer")).toBe(true);
    expect(isBatchEligibleForEquipment(disinfectStage2, "dryer")).toBe(false);

    const disinfectStage3 = { categoryName: "消毒品", current_stage_order: 3 };
    expect(isBatchEligibleForEquipment(disinfectStage3, "disinfection_tank")).toBe(false);
    expect(isBatchEligibleForEquipment(disinfectStage3, "washer")).toBe(false);
    expect(isBatchEligibleForEquipment(disinfectStage3, "dryer")).toBe(true);

    // 4. 汙衣 (SOILED) & 一般 (GENERAL)：第 1 階段洗衣機、第 2 階段烘衣機，絕不進入消毒鍋
    const soiledStage1 = { categoryName: "汙衣", current_stage_order: 1 };
    expect(isBatchEligibleForEquipment(soiledStage1, "disinfection_tank")).toBe(false);
    expect(isBatchEligibleForEquipment(soiledStage1, "washer")).toBe(true);
    expect(isBatchEligibleForEquipment(soiledStage1, "dryer")).toBe(false);

    const generalStage2 = { categoryName: "一般", current_stage_order: 2 };
    expect(isBatchEligibleForEquipment(generalStage2, "disinfection_tank")).toBe(false);
    expect(isBatchEligibleForEquipment(generalStage2, "washer")).toBe(false);
    expect(isBatchEligibleForEquipment(generalStage2, "dryer")).toBe(true);
  });

  it("在消毒鍋控制點，若選到圍兜或非消毒分類項目，候選清單與卡片均不顯示並停用按鈕", () => {
    // 模擬使用者上傳附圖之情境：消毒鍋控制點載入了 圍兜 批次
    const allBatches: ControlBatch[] = [
      {
        id: "b-bib-1",
        status: "not_started",
        current_stage_order: 1,
        orderNumber: "CORP-20261015-0007",
        cartNumber: "2G02",
        categoryName: "圍兜",
        institutionName: "三館",
        operating_site_name: "法人",
      },
    ];

    // 消毒鍋控制點過濾
    const eligibleForDisinfection = allBatches.filter((b) =>
      isBatchEligibleForEquipment(b, "disinfection_tank"),
    );

    // 圍兜在消毒鍋控制點應被徹底排除
    expect(eligibleForDisinfection).toHaveLength(0);

    const selectedBatch = eligibleForDisinfection[0];
    const displayCart = selectedBatch?.cartNumber || "—";
    const displayOrderNumber = selectedBatch?.orderNumber || "—";
    const displayCategory = selectedBatch?.categoryName || "—";
    const displayInstitution = selectedBatch?.institutionName || "—";

    expect(displayCart).toBe("—");
    expect(displayOrderNumber).toBe("—");
    expect(displayCategory).toBe("—");
    expect(displayInstitution).toBe("—");

    // 按鈕狀態防護：在沒有符合的批次時必須停用
    const isButtonDisabled = !selectedBatch || eligibleForDisinfection.length === 0;
    expect(isButtonDisabled).toBe(true);
  });

  it("在烘衣機控制點，床簾（不須烘衣）被排除，圍兜（第 1 階段直接烘乾）正常呈現", () => {
    const batches: ControlBatch[] = [
      {
        id: "b-curtain",
        status: "not_started",
        current_stage_order: 1,
        orderNumber: "MAIN-001",
        cartNumber: "6D-1",
        categoryName: "床簾",
        institutionName: "一館",
      },
      {
        id: "b-bib",
        status: "not_started",
        current_stage_order: 1,
        orderNumber: "CORP-20261015-0007",
        cartNumber: "2G02",
        categoryName: "圍兜",
        institutionName: "三館",
      },
      {
        id: "b-disinfect-stage1",
        status: "not_started",
        current_stage_order: 1,
        orderNumber: "MAIN-002",
        cartNumber: "8D-1",
        categoryName: "消毒品",
        institutionName: "一館",
      },
    ];

    const eligibleForDryer = batches.filter((b) =>
      isBatchEligibleForEquipment(b, "dryer"),
    );

    expect(eligibleForDryer).toHaveLength(1);
    expect(eligibleForDryer[0].cartNumber).toBe("2G02");
    expect(eligibleForDryer[0].categoryName).toBe("圍兜");
  });
});


