"use client";

import { useState } from "react";

import styles from "../../workspace.module.css";

type CategoryOption = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  active: boolean;
};

export function CategoryEditForm({
  categories,
  requestId,
}: {
  categories: CategoryOption[];
  requestId: string;
}) {
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? "");
  const selected = categories.find((category) => category.id === selectedId);
  const [active, setActive] = useState(selected?.active ?? true);

  if (!selected) {
    return <p>目前沒有可修改的分類。</p>;
  }

  return (
    <>
      <input name="change_request_id" type="hidden" value={requestId} />
      <input name="category_id" type="hidden" value={selected.id} />
      <input name="category_code" type="hidden" value={selected.code} />
      <input name="category_active" type="hidden" value={active ? "true" : "false"} />
      <label>
        選擇分類
        <select
          value={selectedId}
          onChange={(event) => {
            const nextId = event.target.value;
            const next = categories.find((category) => category.id === nextId);
            setSelectedId(nextId);
            setActive(next?.active ?? true);
          }}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name} · {category.code}
              {category.active ? "" : "（停用）"}
            </option>
          ))}
        </select>
      </label>
      <label>
        分類名稱
        <input
          key={`${selected.id}-name`}
          name="category_name"
          defaultValue={selected.name}
          maxLength={80}
          required
        />
      </label>
      <label>
        排序
        <input
          key={`${selected.id}-sort`}
          name="sort_order"
          type="number"
          min={0}
          defaultValue={selected.sort_order}
          required
        />
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        分類啟用
      </label>
      <label>
        異動理由
        <input name="change_reason" maxLength={500} required />
      </label>
    </>
  );
}
