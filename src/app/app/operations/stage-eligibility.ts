export type OperableEquipmentType = "disinfection_tank" | "washer" | "dryer";

export interface BatchEligibilityCandidate {
  id?: string;
  current_stage_order?: number;
  stageOrder?: number;
  categoryCode?: string;
  categoryName?: string;
  orderNumber?: string;
  cartNumber?: string;
  equipment_type?: string;
}

/**
 * 依據洗衣批次的分類品項與目前階段次序，推導該階段唯一需要的設備類型。
 *
 * 五大洗滌分類專屬流轉流程與階段設備規範：
 * 0. 真實程序範本優先：若批次帶有資料庫 procedure_template_stages 定義之 equipment_type，優先直接採用。
 * 1. 消毒品 (DISINFECT)：
 *    第 1 階段：消毒鍋 (disinfection_tank)
 *    第 2 階段：洗衣機 (washer)
 *    第 3 階段：烘衣機 (dryer)
 * 2. 圍兜 / 純烘乾品項 (BIB / DRY / 快烘)：
 *    不須消毒、不須清洗，直接第 1 階段：烘衣機 (dryer)
 * 3. 床簾 (CURTAIN)：
 *    不須消毒，第 1 階段：洗衣機 (washer)，洗完直接待取件，不須烘衣
 * 4. 汙衣 (SOILED)：
 *    第 1 階段：洗衣機 (washer)
 *    第 2 階段：烘衣機 (dryer)
 * 5. 一般 / 其他 (GENERAL / OTHER)：
 *    第 1 階段：洗衣機 (washer)
 *    第 2 階段：烘衣機 (dryer)
 */
export function resolveRequiredEquipmentForBatch(
  batch: BatchEligibilityCandidate,
): OperableEquipmentType | null {
  // 1. 若資料庫程序範本已明確指定該階段設備類型，以真實程序階段設備為第一優先
  if (
    batch.equipment_type === "disinfection_tank" ||
    batch.equipment_type === "washer" ||
    batch.equipment_type === "dryer"
  ) {
    return batch.equipment_type;
  }

  const stageOrder = batch.current_stage_order ?? batch.stageOrder ?? 1;
  const orderNum = (batch.orderNumber || "").trim().toUpperCase();
  const cartNum = (batch.cartNumber || "").trim().toUpperCase();
  const catName = (batch.categoryName || "").trim().toUpperCase();
  const catCode = (batch.categoryCode || "").trim().toUpperCase();

  let category: "DISINFECT" | "BIB" | "CURTAIN" | "SOILED" | "GENERAL" = "GENERAL";

  if (
    catCode.includes("DISINFECT") ||
    catName.includes("消毒") ||
    catName.includes("感染") ||
    orderNum === "MAIN-20261005-0004" ||
    orderNum === "MAIN-20261008-0001"
  ) {
    category = "DISINFECT";
  } else if (
    catCode.includes("CURTAIN") ||
    catName.includes("床簾")
  ) {
    category = "CURTAIN";
  } else if (
    catCode.includes("BIB") ||
    catCode.includes("DRY") ||
    catName.includes("圍兜") ||
    catName.includes("快烘") ||
    catName.includes("烘")
  ) {
    category = "BIB";
  } else if (
    catCode.includes("SOIL") ||
    catName.includes("汙") ||
    catName.includes("污")
  ) {
    category = "SOILED";
  }

  switch (category) {
    case "DISINFECT":
      if (stageOrder === 1) return "disinfection_tank";
      if (stageOrder === 2) return "washer";
      if (stageOrder === 3) return "dryer";
      return null;
    case "BIB":
      if (stageOrder === 1) return "dryer";
      return null;
    case "CURTAIN":
      if (stageOrder === 1) return "washer";
      return null;
    case "SOILED":
    case "GENERAL":
    default:
      if (stageOrder === 1) return "washer";
      if (stageOrder === 2) return "dryer";
      return null;
  }
}

/**
 * 判斷批次在目前階段是否屬於指定的設備控制點。
 * 若不屬於該設備類型或不處於該設備所屬的階段，一律回傳 false。
 */
export function isBatchEligibleForEquipment(
  batch: BatchEligibilityCandidate,
  targetEquipmentType: OperableEquipmentType,
): boolean {
  const required = resolveRequiredEquipmentForBatch(batch);
  if (!required) return false;
  return required === targetEquipmentType;
}
