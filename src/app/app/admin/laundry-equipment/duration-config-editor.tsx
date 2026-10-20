"use client";

import { getDefaultDurationForCategory } from "@/lib/laundry-equipment/duration-config";
import styles from "../../workspace.module.css";

export type CategoryOption = { code: string; name: string };

export function DurationConfigEditor({
  categories,
  selectedCategoryCodes,
  onCategoryToggle,
  defaultMinutes,
  onDefaultMinutesChange,
  categoryDurations,
  onCategoryDurationChange,
  equipmentType,
  fieldName = "category_codes",
}: {
  categories: CategoryOption[];
  selectedCategoryCodes: string[];
  onCategoryToggle: (code: string, checked: boolean) => void;
  defaultMinutes: number;
  onDefaultMinutesChange: (val: number) => void;
  categoryDurations: Record<string, number>;
  onCategoryDurationChange: (code: string, val: number) => void;
  equipmentType?: string | null;
  fieldName?: string;
}) {
  const activeJson: Record<string, number> = {
    default: defaultMinutes,
  };
  for (const code of selectedCategoryCodes) {
    const cat = categories.find((c) => c.code === code);
    const catName = cat?.name ?? code;
    activeJson[code] =
      categoryDurations[code] ??
      getDefaultDurationForCategory(catName || code, equipmentType);
  }

  return (
    <>
      <label>
        清洗時間基準（預設分鐘）
        <input
          name="cleaning_duration_minutes"
          type="number"
          min={1}
          max={1440}
          value={defaultMinutes}
          onChange={(event) => {
            const val = Number(event.target.value);
            onDefaultMinutesChange(val > 0 ? val : 60);
          }}
          required
        />
      </label>

      <fieldset className={styles.compatList}>
        <legend>適用分類</legend>
        {categories.map((category) => (
          <label className={styles.checkboxLabel} key={category.code}>
            <input
              type="checkbox"
              name={fieldName}
              value={category.code}
              checked={selectedCategoryCodes.includes(category.code)}
              onChange={(event) => onCategoryToggle(category.code, event.target.checked)}
            />
            {category.name}
          </label>
        ))}
      </fieldset>

      {selectedCategoryCodes.length > 0 ? (
        <div
          style={{
            padding: "0.85rem 1rem",
            borderRadius: "8px",
            background: "var(--surface-subtle, rgba(255, 255, 255, 0.03))",
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
            marginTop: "0.5rem",
            marginBottom: "0.75rem",
          }}
        >
          <div
            style={{
              fontWeight: 650,
              fontSize: "0.92rem",
              marginBottom: "0.6rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <span>⏱️ 已勾選分類專屬清洗時間</span>
            <span style={{ fontSize: "0.78rem", fontWeight: 400, color: "var(--muted, #94a3b8)" }}>
              (依分類自動帶入預設，可手動微調)
            </span>
          </div>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {selectedCategoryCodes.map((code) => {
              const cat = categories.find((c) => c.code === code);
              const catName = cat?.name ?? code;
              const presetVal = getDefaultDurationForCategory(catName || code, equipmentType);
              const currentVal = categoryDurations[code] ?? presetVal;
              return (
                <div
                  key={code}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.4rem 0.65rem",
                    borderRadius: "6px",
                    background: "var(--surface-sunken, rgba(0, 0, 0, 0.2))",
                    border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{catName}</span>
                    <code style={{ fontSize: "0.78rem", color: "var(--muted, #94a3b8)" }}>({code})</code>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "#38bdf8",
                        background: "rgba(56, 189, 248, 0.1)",
                        padding: "0.1rem 0.35rem",
                        borderRadius: "4px",
                      }}
                    >
                      預設 {presetVal}分
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={currentVal}
                      onChange={(event) => {
                        const val = Number(event.target.value);
                        onCategoryDurationChange(code, val > 0 ? val : 1);
                      }}
                      style={{
                        width: "80px",
                        textAlign: "right",
                        padding: "0.25rem 0.4rem",
                        borderRadius: "4px",
                        fontSize: "0.9rem",
                      }}
                    />
                    <span style={{ fontSize: "0.85rem", color: "var(--foreground-muted, #cbd5e1)" }}>分鐘</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p style={{ margin: "0.25rem 0 0.5rem", fontSize: "0.82rem", color: "var(--muted, #94a3b8)" }}>
          💡 未勾選特定分類，此設備全體洗滌作業將採用基準預設清洗時間（{defaultMinutes} 分鐘）。
        </p>
      )}

      <div style={{ marginTop: "0.5rem", marginBottom: "0.75rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "0.25rem",
          }}
        >
          <span style={{ fontSize: "0.82rem", fontWeight: 650, color: "var(--muted, #94a3b8)" }}>
            📋 清洗時間 JSON 配置（即時預覽）
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--muted, #64748b)" }}>
            基準預設 + {selectedCategoryCodes.length} 項勾選分類
          </span>
        </div>
        <pre
          style={{
            margin: 0,
            padding: "0.6rem 0.8rem",
            borderRadius: "6px",
            background: "var(--surface-sunken, #090d16)",
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
            color: "#38bdf8",
            fontSize: "0.82rem",
            lineHeight: 1.45,
            overflowX: "auto",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          {JSON.stringify(activeJson, null, 2)}
        </pre>
        <input type="hidden" name="cleaning_duration_json" value={JSON.stringify(activeJson)} />
      </div>
    </>
  );
}
