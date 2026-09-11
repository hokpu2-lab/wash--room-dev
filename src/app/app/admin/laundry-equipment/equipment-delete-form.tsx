"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import styles from "../../workspace.module.css";

type EquipmentOption = { id: string; name: string };

function DeleteButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={!enabled || pending}>
      {pending ? "正在檢查並刪除…" : "永久刪除設備"}
    </button>
  );
}

export function EquipmentDeleteForm({
  equipment,
  requestId,
}: {
  equipment: EquipmentOption[];
  requestId: string;
}) {
  const [selectedId, setSelectedId] = useState(equipment[0]?.id ?? "");
  const [typedName, setTypedName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const selected = equipment.find((item) => item.id === selectedId);

  if (!selected) return <p>目前沒有可刪除的設備。</p>;

  const nameMatches = typedName.trim().toUpperCase() === selected.name.toUpperCase();

  return (
    <>
      <input name="change_request_id" type="hidden" value={requestId} />
      <input name="laundry_equipment_id" type="hidden" value={selected.id} />
      <label>
        選擇要刪除的設備
        <select
          value={selectedId}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setTypedName("");
            setConfirmed(false);
          }}
        >
          {equipment.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>
      <p>
        系統只會刪除從未參與送洗、排程或設備操作的資料；若已有紀錄，將拒絕刪除並保留原狀。
      </p>
      <label>
        再次輸入設備名稱「{selected.name}」
        <input
          name="expected_equipment_name"
          value={typedName}
          onChange={(event) => setTypedName(event.target.value)}
          autoComplete="off"
          maxLength={80}
          required
        />
      </label>
      <label>
        刪除原因
        <input name="change_reason" maxLength={500} required />
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          name="delete_confirmed"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          required
        />
        我確認設備建立錯誤，且了解刪除後固定 QR 立即失效、無法復原
      </label>
      <DeleteButton enabled={nameMatches && confirmed} />
    </>
  );
}
