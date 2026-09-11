"use client";

import { useId, useState } from "react";

import styles from "../../workspace.module.css";
import {
  defaultProcedureStage,
  equipmentLabels,
  equipmentTypes,
  serializeProcedureStages,
  type ProcedureStageDraft,
} from "./procedure-stage-draft";

const commonStageNames = ["浸泡", "清洗", "烘乾", "裝車"];

export function ProcedureStagesField({
  initialStages,
  categories,
}: {
  initialStages: ProcedureStageDraft[];
  categories: Array<{ code: string; name: string }>;
}) {
  const nameListId = useId();
  const [stages, setStages] = useState(
    initialStages.length > 0 ? initialStages : [defaultProcedureStage()],
  );

  function updateStage(index: number, patch: Partial<ProcedureStageDraft>) {
    setStages((current) =>
      current.map((stage, stageIndex) => {
        if (stageIndex !== index) return stage;
        const next = { ...stage, ...patch };
        if (next.equipment_type !== "manual") {
          next.transition_mode = "manual";
          next.requires_operator_confirmation = true;
        }
        return next;
      }),
    );
  }

  return (
    <div className={styles.stageList}>
      <input type="hidden" name="stages_json" value={serializeProcedureStages(stages)} />
      <datalist id={nameListId}>
        {commonStageNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {stages.map((stage, index) => {
        const machineStage = stage.equipment_type !== "manual";
        return (
          <article className={styles.stageCard} key={`stage-${index.toString()}`}>
            <header>
              <strong>第 {index + 1} 階段</strong>
              <button
                type="button"
                disabled={stages.length === 1}
                onClick={() =>
                  setStages((current) => current.filter((_, stageIndex) => stageIndex !== index))
                }
              >
                移除
              </button>
            </header>
            <div className={styles.stageFields}>
              <label>
                階段名稱
                <input
                  list={nameListId}
                  value={stage.name}
                  maxLength={40}
                  required
                  onChange={(event) => updateStage(index, { name: event.target.value })}
                />
              </label>
              <label>
                標準分鐘
                <input
                  type="number"
                  min={1}
                  value={stage.standard_minutes}
                  required
                  onChange={(event) =>
                    updateStage(index, {
                      standard_minutes: Number(event.target.value) || 1,
                    })
                  }
                />
              </label>
              <label>
                設備類型
                <select
                  value={stage.equipment_type}
                  onChange={(event) =>
                    updateStage(index, {
                      equipment_type: event.target.value as ProcedureStageDraft["equipment_type"],
                    })
                  }
                >
                  {equipmentTypes.map((type) => (
                    <option key={type} value={type}>
                      {equipmentLabels[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                轉場方式
                <select
                  value={stage.transition_mode}
                  disabled={machineStage}
                  onChange={(event) =>
                    updateStage(index, {
                      transition_mode: event.target.value as ProcedureStageDraft["transition_mode"],
                    })
                  }
                >
                  <option value="manual">人工確認</option>
                  <option value="timer">計時轉場</option>
                </select>
              </label>
            </div>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={stage.requires_operator_confirmation}
                disabled={machineStage}
                onChange={(event) =>
                  updateStage(index, {
                    requires_operator_confirmation: event.target.checked,
                  })
                }
              />
              需要作業員確認
            </label>
            {categories.length > 0 ? (
              <fieldset className={styles.compatList}>
                <legend>相容分類</legend>
                {categories.map((category) => {
                  const checked = stage.category_codes.includes(category.code);
                  return (
                    <label className={styles.checkboxLabel} key={category.code}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          updateStage(index, {
                            category_codes: event.target.checked
                              ? [...stage.category_codes, category.code]
                              : stage.category_codes.filter((code) => code !== category.code),
                          })
                        }
                      />
                      {category.name}
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
          </article>
        );
      })}
      <div className={styles.stageActions}>
        <button
          type="button"
          onClick={() => setStages((current) => [...current, defaultProcedureStage()])}
        >
          新增階段
        </button>
      </div>
    </div>
  );
}
