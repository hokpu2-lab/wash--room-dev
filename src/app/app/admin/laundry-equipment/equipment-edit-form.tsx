"use client";

import { useState } from "react";

import { getDefaultDurationForCategory } from "@/lib/laundry-equipment/duration-config";
import { DurationConfigEditor } from "./duration-config-editor";
import styles from "../../workspace.module.css";

type EquipmentOption = {
  id: string;
  name: string;
  equipment_type?: "disinfection_tank" | "washer" | "dryer";
  capacity_kg?: number | null;
  cleaning_duration_minutes?: number;
  cleaning_duration_config?: Record<string, number>;
  status: "normal" | "inactive" | "abnormal" | "maintenance";
  operating_site_id?: string;
  category_codes: string[];
  procedure_template_ids: string[];
};

type CategoryOption = { code: string; name: string };
type ProcedureOption = {
  id: string;
  operating_site_id: string;
  label: string;
};

const statusLabels = {
  normal: "正常",
  inactive: "停用",
  abnormal: "異常",
  maintenance: "維修中",
} as const;

export function EquipmentEditForm({
  equipment,
  categories,
  procedures,
  requestId,
}: {
  equipment: EquipmentOption[];
  categories: CategoryOption[];
  procedures: ProcedureOption[];
  requestId: string;
}) {
  const [selectedId, setSelectedId] = useState(equipment[0]?.id ?? "");
  const selected = equipment.find((item) => item.id === selectedId);
  const [status, setStatus] = useState(selected?.status ?? "normal");

  const defaultReasons: Record<string, string> = {
    abnormal: "⚠️ 設備故障異常待修",
    maintenance: "🔧 設備例行保養維修中",
    normal: "✅ 維修檢驗完畢，恢復正常運作",
    inactive: "⛔ 設備停用暫不指派",
  };

  const [changeReason, setChangeReason] = useState(
    selected?.status && selected.status !== "normal"
      ? defaultReasons[selected.status] ?? ""
      : ""
  );

  const initialDefault =
    selected?.cleaning_duration_minutes ??
    selected?.cleaning_duration_config?.default ??
    60;
  const [defaultMinutes, setDefaultMinutes] = useState(initialDefault);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    selected?.category_codes ?? []
  );
  const [categoryDurations, setCategoryDurations] = useState<Record<string, number>>(
    selected?.cleaning_duration_config ?? {}
  );

  const handleStatusChange = (nextStatus: typeof status) => {
    setStatus(nextStatus);
    if (!changeReason || Object.values(defaultReasons).includes(changeReason)) {
      setChangeReason(defaultReasons[nextStatus] ?? "");
    }
  };

  const handleEquipmentChange = (nextId: string) => {
    setSelectedId(nextId);
    const next = equipment.find((item) => item.id === nextId);
    if (next) {
      setStatus(next.status);
      const nextDefault =
        next.cleaning_duration_minutes ?? next.cleaning_duration_config?.default ?? 60;
      setDefaultMinutes(nextDefault);
      setSelectedCategories(next.category_codes);
      const nextDurations: Record<string, number> = { ...(next.cleaning_duration_config ?? {}) };
      nextDurations.default = nextDefault;
      for (const code of next.category_codes) {
        if (typeof nextDurations[code] !== "number") {
          nextDurations[code] = getDefaultDurationForCategory(code, next.equipment_type);
        }
      }
      setCategoryDurations(nextDurations);
      if (!changeReason || Object.values(defaultReasons).includes(changeReason)) {
        setChangeReason(next.status !== "normal" ? (defaultReasons[next.status] ?? "") : "");
      }
    }
  };

  const handleCategoryToggle = (code: string, checked: boolean) => {
    if (checked) {
      setSelectedCategories((prev) => (prev.includes(code) ? prev : [...prev, code]));
      setCategoryDurations((prev) => {
        const next = { ...prev };
        if (typeof next[code] !== "number") {
          next[code] = getDefaultDurationForCategory(code, selected?.equipment_type);
        }
        return next;
      });
    } else {
      setSelectedCategories((prev) => prev.filter((item) => item !== code));
      setCategoryDurations((prev) => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
    }
  };

  const handleCategoryDurationChange = (code: string, val: number) => {
    setCategoryDurations((prev) => ({
      ...prev,
      [code]: val,
    }));
  };

  const isProcedureCompatibleWithEquipment = (
    procedureLabel: string,
    equipType?: "disinfection_tank" | "washer" | "dryer"
  ) => {
    if (!equipType) return true;
    const lower = procedureLabel.toLowerCase();
    // 圍兜僅需烘衣：洗衣機與消毒鍋不相容
    if ((lower.includes("圍兜") || lower.includes("bib")) && equipType !== "dryer") {
      return false;
    }
    // 床簾不需烘衣：烘衣機與消毒鍋不相容
    if ((lower.includes("床簾") || lower.includes("curtain")) && equipType !== "washer") {
      return false;
    }
    return true;
  };

  const visibleProcedures = procedures.filter(
    (procedure) =>
      (!selected?.operating_site_id || procedure.operating_site_id === selected.operating_site_id) &&
      isProcedureCompatibleWithEquipment(procedure.label, selected?.equipment_type)
  );

  if (!selected) {
    return <p>目前沒有可修改的設備。</p>;
  }

  return (
    <>
      <input name="change_request_id" type="hidden" value={requestId} />
      <input name="laundry_equipment_id" type="hidden" value={selected.id} />
      <label>
        選擇設備
        <select
          value={selectedId}
          onChange={(event) => handleEquipmentChange(event.target.value)}
        >
          {equipment.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        設備名稱
        <input
          key={`${selected.id}-name`}
          name="name"
          defaultValue={selected.name}
          maxLength={80}
          required
        />
      </label>
      <label>
        可容納洗衣車（台）
        <input
          key={`${selected.id}-capacity`}
          name="capacity_kg"
          type="number"
          min={1}
          max={20}
          defaultValue={selected.capacity_kg ?? 1}
        />
      </label>
      <label>
        設備狀態
        <select
          name="status"
          value={status}
          onChange={(event) => handleStatusChange(event.target.value as typeof status)}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <DurationConfigEditor
        key={`${selected.id}-duration-config`}
        categories={categories}
        selectedCategoryCodes={selectedCategories}
        onCategoryToggle={handleCategoryToggle}
        defaultMinutes={defaultMinutes}
        onDefaultMinutesChange={setDefaultMinutes}
        categoryDurations={categoryDurations}
        onCategoryDurationChange={handleCategoryDurationChange}
        equipmentType={selected?.equipment_type}
        fieldName="category_codes"
      />

      <fieldset className={styles.compatList}>
        <legend>相容程序</legend>
        {visibleProcedures.length === 0 ? <p>此據點尚無已發布程序。</p> : null}
        {visibleProcedures.map((procedure) => (
          <label className={styles.checkboxLabel} key={`${selected.id}-${procedure.id}`}>
            <input
              type="checkbox"
              name="procedure_template_ids"
              value={procedure.id}
              defaultChecked={selected.procedure_template_ids.includes(procedure.id)}
            />
            {procedure.label}
          </label>
        ))}
      </fieldset>

      <div style={{ marginTop: "0.6rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "0.35rem",
          }}
        >
          <label
            htmlFor="change-reason-input"
            style={{
              fontWeight: 650,
              fontSize: "0.92rem",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              margin: 0,
            }}
          >
            <span>異動理由</span>
            <span style={{ color: "#f87171", fontSize: "0.82rem", fontWeight: 700 }}>* 必填稽核項目</span>
          </label>
          <span style={{ fontSize: "0.78rem", color: "var(--muted, #94a3b8)" }}>
            （切換狀態會自動預填，亦可自訂輸入）
          </span>
        </div>
        <input
          id="change-reason-input"
          name="change_reason"
          maxLength={500}
          required
          value={changeReason}
          onChange={(event) => setChangeReason(event.target.value)}
          placeholder="請輸入異動理由（例如：機台加熱管故障待修、定期例行保養等）"
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.45rem" }}>
          {Object.entries(defaultReasons).map(([key, text]) => (
            <button
              key={key}
              type="button"
              onClick={() => setChangeReason(text)}
              style={{
                fontSize: "0.78rem",
                padding: "0.25rem 0.6rem",
                borderRadius: "9999px",
                border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))",
                background:
                  changeReason === text
                    ? "var(--accent, #0d9488)"
                    : "var(--surface-sunken, rgba(0, 0, 0, 0.25))",
                color: changeReason === text ? "#ffffff" : "var(--foreground-muted, #cbd5e1)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
