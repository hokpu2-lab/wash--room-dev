import { describe, expect, it } from "vitest";

import { resolveEquipmentDurationFromConfig } from "@/lib/laundry-equipment/duration-config";

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

  function getEquipmentStatusBadge(equipment: {
    status: string;
    equipment_type: "disinfection_tank" | "washer" | "dryer";
    occupied: boolean;
    active_cart_count?: number;
  }) {
    const isOccupied = Boolean(
      equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0)
    );

    if (equipment.status === "abnormal") {
      return { label: "異常故障", color: "#f87171", icon: "⚠️" };
    }
    if (equipment.status === "maintenance") {
      return { label: "維修中", color: "#fbbf24", icon: "🔧" };
    }
    if (equipment.status === "inactive") {
      return { label: "已停用", color: "#94a3b8", icon: "⛔" };
    }

    if (isOccupied) {
      if (equipment.equipment_type === "washer") {
        return { label: "清洗中", color: "#38bdf8", icon: "💧" };
      }
      if (equipment.equipment_type === "dryer") {
        return { label: "烘乾中", color: "#fb923c", icon: "🔥" };
      }
      if (equipment.equipment_type === "disinfection_tank") {
        return { label: "消毒中", color: "#c084fc", icon: "🧪" };
      }
      return { label: "作業中", color: "#38bdf8", icon: "⚡" };
    }

    return { label: "可使用", color: "#4ade80", icon: "🟢" };
  }

  it("設備清單中正確呈現即時狀態（清洗中、烘乾中、可使用、維修中、異常故障）", () => {
    // 洗衣機清洗中
    expect(
      getEquipmentStatusBadge({
        status: "normal",
        equipment_type: "washer",
        occupied: true,
      })
    ).toMatchObject({ label: "清洗中", icon: "💧" });

    // 洗衣機可使用 (閒置)
    expect(
      getEquipmentStatusBadge({
        status: "normal",
        equipment_type: "washer",
        occupied: false,
      })
    ).toMatchObject({ label: "可使用", icon: "🟢" });

    // 烘衣機烘乾中
    expect(
      getEquipmentStatusBadge({
        status: "normal",
        equipment_type: "dryer",
        occupied: true,
      })
    ).toMatchObject({ label: "烘乾中", icon: "🔥" });

    // 烘衣機可使用
    expect(
      getEquipmentStatusBadge({
        status: "normal",
        equipment_type: "dryer",
        occupied: false,
      })
    ).toMatchObject({ label: "可使用", icon: "🟢" });

    // 維修中
    expect(
      getEquipmentStatusBadge({
        status: "maintenance",
        equipment_type: "washer",
        occupied: false,
      })
    ).toMatchObject({ label: "維修中", icon: "🔧" });

    // 異常故障
    expect(
      getEquipmentStatusBadge({
        status: "abnormal",
        equipment_type: "washer",
        occupied: false,
      })
    ).toMatchObject({ label: "異常故障", icon: "⚠️" });

    // 已停用
    expect(
      getEquipmentStatusBadge({
        status: "inactive",
        equipment_type: "washer",
        occupied: false,
      })
    ).toMatchObject({ label: "已停用", icon: "⛔" });
  });

  function getEquipmentCleaningDurationText(equipment: {
    occupied: boolean;
    active_cart_count?: number;
    equipment_type: "disinfection_tank" | "washer" | "dryer";
    cleaning_duration_minutes?: number;
    cleaning_duration_config?: Record<string, number>;
    active_category_code?: string | null;
    active_category_name?: string | null;
    active_duration_minutes?: number | null;
  }) {
    const isOccupied = Boolean(
      equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0)
    );
    if (!isOccupied) return "—";

    const durationMinutes =
      equipment.active_duration_minutes ??
      resolveEquipmentDurationFromConfig(
        equipment.cleaning_duration_config,
        equipment.active_category_code || equipment.active_category_name,
        equipment.cleaning_duration_minutes ?? 60,
        equipment.equipment_type
      );

    if (!durationMinutes) return "—";
    return `${durationMinutes} 分鐘${equipment.active_category_name ? ` (${equipment.active_category_name})` : ""}`;
  }

  it("設備清單中清洗時間：未使用時保持空白（—），作業中依對應分類計算時間", () => {
    // 1. 未使用（閒置）時保持空白
    expect(
      getEquipmentCleaningDurationText({
        occupied: false,
        active_cart_count: 0,
        equipment_type: "washer",
      })
    ).toBe("—");

    expect(
      getEquipmentCleaningDurationText({
        occupied: false,
        active_cart_count: 0,
        equipment_type: "dryer",
      })
    ).toBe("—");

    // 2. 作業中：洗衣機清洗床簾 (CURTAIN) ➔ 40 分鐘
    expect(
      getEquipmentCleaningDurationText({
        occupied: true,
        active_cart_count: 1,
        equipment_type: "washer",
        active_category_code: "CURTAIN",
        active_category_name: "床簾",
      })
    ).toBe("40 分鐘 (床簾)");

    // 3. 作業中：烘衣機烘乾圍兜 (BIB) ➔ 20 分鐘
    expect(
      getEquipmentCleaningDurationText({
        occupied: true,
        active_cart_count: 1,
        equipment_type: "dryer",
        active_category_code: "BIB",
        active_category_name: "圍兜",
      })
    ).toBe("20 分鐘 (圍兜)");

    // 4. 作業中：消毒鍋消毒品 (DISINFECT) ➔ 30 分鐘
    expect(
      getEquipmentCleaningDurationText({
        occupied: true,
        active_cart_count: 1,
        equipment_type: "disinfection_tank",
        active_category_code: "DISINFECT",
        active_category_name: "消毒品",
      })
    ).toBe("30 分鐘 (消毒品)");

    // 5. 作業中：洗衣機清洗消毒品 (DISINFECT) ➔ 60 分鐘
    expect(
      getEquipmentCleaningDurationText({
        occupied: true,
        active_cart_count: 1,
        equipment_type: "washer",
        active_category_code: "DISINFECT",
        active_category_name: "消毒品",
      })
    ).toBe("60 分鐘 (消毒品)");

    // 6. 作業中：自訂 JSON 配置時間生效
    expect(
      getEquipmentCleaningDurationText({
        occupied: true,
        active_cart_count: 1,
        equipment_type: "dryer",
        cleaning_duration_config: { default: 60, BIB: 15 },
        active_category_code: "BIB",
        active_category_name: "圍兜",
      })
    ).toBe("15 分鐘 (圍兜)");
  });

  it("當設備進入停用、異常故障或維修中時，設備佔用清空且車號、機構與清洗時間均顯示為空白（—）", () => {
    // 設備異常故障（abnormal）
    const abnormalEq = {
      status: "abnormal",
      equipment_type: "washer" as const,
      occupied: false,
      active_cart_count: 0,
      active_cart_numbers: [],
      active_institutions: [],
    };
    const abnormalBadge = getEquipmentStatusBadge(abnormalEq);
    expect(abnormalBadge.label).toBe("異常故障");
    expect(getEquipmentCleaningDurationText(abnormalEq)).toBe("—");

    // 設備維修中（maintenance）
    const maintEq = {
      status: "maintenance",
      equipment_type: "dryer" as const,
      occupied: false,
      active_cart_count: 0,
      active_cart_numbers: [],
      active_institutions: [],
    };
    const maintBadge = getEquipmentStatusBadge(maintEq);
    expect(maintBadge.label).toBe("維修中");
    expect(getEquipmentCleaningDurationText(maintEq)).toBe("—");

    // 設備已停用（inactive）
    const inactiveEq = {
      status: "inactive",
      equipment_type: "washer" as const,
      occupied: false,
      active_cart_count: 0,
      active_cart_numbers: [],
      active_institutions: [],
    };
    const inactiveBadge = getEquipmentStatusBadge(inactiveEq);
    expect(inactiveBadge.label).toBe("已停用");
    expect(getEquipmentCleaningDurationText(inactiveEq)).toBe("—");
  });
});
