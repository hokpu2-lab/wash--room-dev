"use client";

import { useState } from "react";

import { getDefaultDurationForCategory } from "@/lib/laundry-equipment/duration-config";
import { DurationConfigEditor, type CategoryOption } from "./duration-config-editor";
import styles from "../../workspace.module.css";

type SiteOption = { id: string; code: string; name: string };
type ProcedureOption = { id: string; operating_site_id: string; label: string };

export function EquipmentCreateForm({
  sites,
  categories,
  procedures,
  requestId,
}: {
  sites: SiteOption[];
  categories: CategoryOption[];
  procedures: ProcedureOption[];
  requestId: string;
}) {
  const [selectedSiteCode, setSelectedSiteCode] = useState(sites[0]?.code ?? "MAIN");
  const [defaultMinutes, setDefaultMinutes] = useState(60);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categoryDurations, setCategoryDurations] = useState<Record<string, number>>({});

  const handleCategoryToggle = (code: string, checked: boolean) => {
    if (checked) {
      setSelectedCategories((prev) => (prev.includes(code) ? prev : [...prev, code]));
      setCategoryDurations((prev) => {
        const next = { ...prev };
        if (typeof next[code] !== "number") {
          next[code] = getDefaultDurationForCategory(code);
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

  return (
    <>
      <input name="change_request_id" type="hidden" value={requestId} />
      <label>
        設備名稱
        <input name="name" maxLength={80} required />
      </label>
      <label>
        設備類型
        <select name="equipment_type" defaultValue="washer">
          <option value="disinfection_tank">消毒鍋</option>
          <option value="washer">洗衣機</option>
          <option value="dryer">烘衣機</option>
        </select>
      </label>
      <label>
        作業據點代碼
        <select
          name="site_code"
          value={selectedSiteCode}
          onChange={(event) => setSelectedSiteCode(event.target.value)}
          required
        >
          {sites.map((site) => (
            <option key={site.id} value={site.code}>
              {site.name} · {site.code}
            </option>
          ))}
        </select>
      </label>
      <label>
        可容納洗衣車（台）
        <input name="capacity_kg" type="number" min={1} max={20} defaultValue={1} />
      </label>

      <DurationConfigEditor
        categories={categories}
        selectedCategoryCodes={selectedCategories}
        onCategoryToggle={handleCategoryToggle}
        defaultMinutes={defaultMinutes}
        onDefaultMinutesChange={setDefaultMinutes}
        categoryDurations={categoryDurations}
        onCategoryDurationChange={handleCategoryDurationChange}
        fieldName="category_codes"
      />

      <fieldset className={styles.compatList}>
        <legend>相容程序</legend>
        {procedures.map((procedure) => (
          <label className={styles.checkboxLabel} key={`create-${procedure.id}`}>
            <input type="checkbox" name="procedure_template_ids" value={procedure.id} />
            {procedure.label}
          </label>
        ))}
      </fieldset>
      <label>
        登錄理由
        <input name="change_reason" maxLength={500} required />
      </label>
      <button type="submit">登錄設備</button>
    </>
  );
}
