export const DEFAULT_CATEGORY_DURATIONS: Record<string, number> = {
  default: 60,
  DISINFECT: 90, // 消毒品
  SOILED: 75,    // 汙衣
  BIB: 45,       // 圍兜
  CURTAIN: 60,   // 床簾
  OTHER: 60,     // 其他
  NORM: 60,      // 一般被服
};

/**
 * 依據分類代碼或名稱回傳預設清洗時間（分鐘）
 */
export function getDefaultDurationForCategory(codeOrName: string): number {
  if (!codeOrName) return 60;
  const upper = codeOrName.toUpperCase();
  if (upper.includes("DISINFECT") || upper.includes("消毒") || upper.includes("感染")) {
    return 90;
  }
  if (upper.includes("SOIL") || upper.includes("汙") || upper.includes("污")) {
    return 75;
  }
  if (upper.includes("BIB") || upper.includes("圍兜")) {
    return 45;
  }
  if (upper.includes("CURTAIN") || upper.includes("床簾")) {
    return 60;
  }
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
 * 依據當前作業分類從設備的 JSON 配置中解析出對應的清洗時間（分鐘）
 */
export function resolveEquipmentDurationFromConfig(
  config?: Record<string, number> | null,
  categoryCodeOrName?: string | null,
  fallbackMinutes: number = 60
): number {
  const defaultMinutes = config?.default ?? fallbackMinutes ?? 60;
  if (!config || typeof config !== "object") {
    return defaultMinutes;
  }

  if (!categoryCodeOrName) {
    return defaultMinutes;
  }

  const rawKey = categoryCodeOrName.trim();
  // 1. 直接精準符合
  if (typeof config[rawKey] === "number") {
    return config[rawKey];
  }
  const upperKey = rawKey.toUpperCase();
  if (typeof config[upperKey] === "number") {
    return config[upperKey];
  }

  // 2. 語意比對（消毒品、汙衣、圍兜等）
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
      (upperKey.includes("CURTAIN") || upperKey.includes("床簾")) &&
      (ku.includes("CURTAIN") || ku.includes("床簾"))
    ) {
      return v;
    }
  }

  return defaultMinutes;
}
