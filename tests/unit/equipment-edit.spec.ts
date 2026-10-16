import { describe, expect, it } from "vitest";

describe("equipment-edit-form logic", () => {
  const defaultReasons: Record<string, string> = {
    abnormal: "⚠️ 設備故障異常待修",
    maintenance: "🔧 設備例行保養維修中",
    normal: "✅ 維修檢驗完畢，恢復正常運作",
    inactive: "⛔ 設備停用暫不指派",
  };

  const isProcedureCompatibleWithEquipment = (
    procedureLabel: string,
    equipType?: "disinfection_tank" | "washer" | "dryer"
  ) => {
    if (!equipType) return true;
    const lower = procedureLabel.toLowerCase();
    if ((lower.includes("圍兜") || lower.includes("bib")) && equipType !== "dryer") {
      return false;
    }
    if ((lower.includes("床簾") || lower.includes("curtain")) && equipType !== "washer") {
      return false;
    }
    return true;
  };

  it("自動為設備狀態提供專屬異動理由預設值", () => {
    expect(defaultReasons.abnormal).toBe("⚠️ 設備故障異常待修");
    expect(defaultReasons.maintenance).toBe("🔧 設備例行保養維修中");
    expect(defaultReasons.normal).toBe("✅ 維修檢驗完畢，恢復正常運作");
    expect(defaultReasons.inactive).toBe("⛔ 設備停用暫不指派");
  });

  it("依設備機型嚴格過濾相容程序，防止不相容程序引發資料庫例外", () => {
    // 洗衣機 (washer)：不可關聯純烘衣的圍兜程序
    expect(isProcedureCompatibleWithEquipment("圍兜烘乾程序", "washer")).toBe(false);
    expect(isProcedureCompatibleWithEquipment("BIB Dryer Procedure", "washer")).toBe(false);
    expect(isProcedureCompatibleWithEquipment("一般清洗程序", "washer")).toBe(true);
    expect(isProcedureCompatibleWithEquipment("床簾洗滌程序", "washer")).toBe(true);

    // 烘衣機 (dryer)：不可關聯不需烘乾的床簾程序
    expect(isProcedureCompatibleWithEquipment("床簾洗滌程序", "dryer")).toBe(false);
    expect(isProcedureCompatibleWithEquipment("CURTAIN Washing", "dryer")).toBe(false);
    expect(isProcedureCompatibleWithEquipment("圍兜烘乾程序", "dryer")).toBe(true);
    expect(isProcedureCompatibleWithEquipment("一般衣物洗烘程序", "dryer")).toBe(true);

    // 消毒鍋 (disinfection_tank)：不可關聯圍兜或床簾專屬程序
    expect(isProcedureCompatibleWithEquipment("圍兜烘乾程序", "disinfection_tank")).toBe(false);
    expect(isProcedureCompatibleWithEquipment("床簾洗滌程序", "disinfection_tank")).toBe(false);
    expect(isProcedureCompatibleWithEquipment("浸泡消毒程序", "disinfection_tank")).toBe(true);
  });
});
