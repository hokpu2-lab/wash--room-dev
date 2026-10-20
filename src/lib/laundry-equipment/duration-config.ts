export const DEFAULT_CATEGORY_DURATIONS: Record<string, number> = {
  default: 60,
  DISINFECT: 30, // 消毒鍋基準 30 分鐘 (洗衣機與烘衣機各為 60 分鐘)
  SOILED: 60,    // 汙衣 60 分鐘
  BIB: 20,       // 圍兜烘衣 20 分鐘
  CURTAIN: 40,   // 床簾清洗 40 分鐘
  OTHER: 60,     // 其他 60 分鐘
  NORM: 60,      // 一般 60 分鐘
  QUICK_DRY: 20, // 快烘 20 分鐘
};

/**
 * 依據分類代碼或名稱與設備類型回傳預設清洗時間（分鐘）
 *
 * 流程與時間規則：
 * - 消毒品：消毒鍋 (30分鐘) ➔ 洗衣機 (60分鐘) ➔ 烘衣機 (60分鐘)
 * - 圍兜 / 快烘 / 純烘乾：不須消毒 ➔ 不須清洗 ➔ 烘衣機 (20分鐘)
 * - 汙衣：不須消毒 ➔ 洗衣機 (60分鐘) ➔ 烘衣機 (60分鐘)
 * - 床簾：不須消毒 ➔ 洗衣機 (40分鐘) ➔ 不須烘衣
 * - 其他：不須消毒 ➔ 洗衣機 (60分鐘) ➔ 烘衣機 (60分鐘)
 */
export function getDefaultDurationForCategory(
  codeOrName: string,
  equipmentType?: string | null
): number {
  const eqType = equipmentType?.toLowerCase();
  if (!codeOrName) {
    return eqType === "disinfection_tank" ? 30 : 60;
  }
  const upper = codeOrName.toUpperCase();

  // 1. 消毒品：消毒鍋 30 分鐘，洗衣機 60 分鐘，烘衣機 60 分鐘
  if (upper.includes("DISINFECT") || upper.includes("消毒") || upper.includes("感染")) {
    if (eqType === "disinfection_tank") return 30;
    if (eqType === "washer") return 60;
    if (eqType === "dryer") return 60;
    return 30;
  }

  // 2. 圍兜 / 快烘 / 純烘乾：不須消毒、不須清洗、烘衣機 20 分鐘
  if (
    upper.includes("BIB") ||
    upper.includes("圍兜") ||
    upper.includes("快烘") ||
    upper.includes("QUICK") ||
    upper.includes("DRY")
  ) {
    return 20;
  }

  // 3. 床簾：不須消毒、洗衣機 40 分鐘、不須烘衣
  if (upper.includes("CURTAIN") || upper.includes("床簾")) {
    return 40;
  }

  // 4. 汙衣：不須消毒、洗衣機 60 分鐘、烘衣機 60 分鐘
  if (upper.includes("SOIL") || upper.includes("汙") || upper.includes("污")) {
    return 60;
  }

  // 5. 其他 / 一般：不須消毒、洗衣機 60 分鐘、烘衣機 60 分鐘
  return 60;
}

/**
 * 解析與正規化 JSON 格式的分類清洗時間配置
 */
export function parseCleaningDurationConfig(
  input: unknown,
  fallbackDefaultMinutes: number = 60
): Record<string, number> {
  const result: Record<string, number> = {
    default: Math.max(1, Math.min(1440, fallbackDefaultMinutes || 60)),
  };

  if (!input) return result;

  let raw: Record<string, unknown> | null = null;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return result;
    }
  } else if (typeof input === "object" && input !== null) {
    raw = input as Record<string, unknown>;
  }

  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      const num = Number(value);
      if (!isNaN(num) && num >= 1 && num <= 1440) {
        result[key] = Math.round(num);
      }
    }
  }

  if (typeof result.default !== "number") {
    result.default = Math.max(1, Math.min(1440, fallbackDefaultMinutes || 60));
  }

  return result;
}

/**
 * 依據當前作業分類與設備類型從 JSON 配置中解析出對應的清洗時間（分鐘）
 */
export function resolveEquipmentDurationFromConfig(
  config?: Record<string, number> | null,
  categoryCodeOrName?: string | null,
  fallbackMinutes: number = 60,
  equipmentType?: string | null
): number {
  const defaultMinutes = config?.default ?? fallbackMinutes ?? 60;

  if (!categoryCodeOrName) {
    return defaultMinutes;
  }

  const rawKey = categoryCodeOrName.trim();
  const upperKey = rawKey.toUpperCase();

  // 1. 若 config 明確有針對該分類設定自訂時間
  if (config && typeof config === "object") {
    if (typeof config[rawKey] === "number") {
      return config[rawKey];
    }
    if (typeof config[upperKey] === "number") {
      return config[upperKey];
    }

    // 語意比對（消毒品、汙衣、圍兜等）
    for (const [k, v] of Object.entries(config)) {
      if (typeof v !== "number") continue;
      const ku = k.toUpperCase();
      if (ku === upperKey) return v;

      if (
        (upperKey.includes("DISINFECT") || upperKey.includes("消毒") || upperKey.includes("感染")) &&
        (ku.includes("DISINFECT") || ku.includes("消毒") || ku.includes("感染"))
      ) {
        return v;
      }
      if (
        (upperKey.includes("SOIL") || upperKey.includes("汙") || upperKey.includes("污")) &&
        (ku.includes("SOIL") || ku.includes("汙") || ku.includes("污"))
      ) {
        return v;
      }
      if (
        (upperKey.includes("BIB") || upperKey.includes("圍兜")) &&
        (ku.includes("BIB") || ku.includes("圍兜"))
      ) {
        return v;
      }
      if (
        (upperKey.includes("快烘") || upperKey.includes("QUICK")) &&
        (ku.includes("快烘") || ku.includes("QUICK"))
      ) {
        return v;
      }
      if (
        (upperKey.includes("CURTAIN") || upperKey.includes("床簾")) &&
        (ku.includes("CURTAIN") || ku.includes("床簾"))
      ) {
        return v;
      }
    }
  }

  // 2. 若 config 未針對該分類設定自訂時間，依設備類型與分類推導標準時間
  const specificDefault = getDefaultDurationForCategory(categoryCodeOrName, equipmentType);
  if (
    specificDefault !== 60 ||
    equipmentType === "disinfection_tank" ||
    upperKey.includes("BIB") ||
    upperKey.includes("圍兜") ||
    upperKey.includes("快烘") ||
    upperKey.includes("DRY") ||
    upperKey.includes("QUICK") ||
    upperKey.includes("CURTAIN") ||
    upperKey.includes("床簾")
  ) {
    return specificDefault;
  }

  return defaultMinutes;
}
