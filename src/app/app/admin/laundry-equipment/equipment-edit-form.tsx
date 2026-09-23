"use client";

import { useState } from "react";

import styles from "../../workspace.module.css";

type EquipmentOption = {
  id: string;
  name: string;
  capacity_kg?: number | null;
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
  const visibleProcedures = procedures.filter(
    (procedure) =>
      !selected?.operating_site_id ||
      procedure.operating_site_id === selected.operating_site_id,
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
          onChange={(event) => {
            const next = equipment.find((item) => item.id === event.target.value);
            setSelectedId(event.target.value);
            setStatus(next?.status ?? "normal");
          }}
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
        <select name="status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className={styles.compatList}>
        <legend>適用分類</legend>
        {categories.map((category) => (
          <label className={styles.checkboxLabel} key={`${selected.id}-${category.code}`}>
            <input
              type="checkbox"
              name="category_codes"
              value={category.code}
              defaultChecked={selected.category_codes.includes(category.code)}
            />
            {category.name}
          </label>
        ))}
      </fieldset>
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
      <label>
        異動理由
        <input name="change_reason" maxLength={500} required />
      </label>
    </>
  );
}
