export const equipmentTypes = [
  "washer",
  "dryer",
  "disinfection_tank",
  "cart",
  "manual",
] as const;

export const equipmentLabels: Record<(typeof equipmentTypes)[number], string> = {
  washer: "洗衣機",
  dryer: "烘衣機",
  disinfection_tank: "消毒鍋",
  cart: "洗衣車",
  manual: "人工／無設備",
};

export type ProcedureStageDraft = {
  name: string;
  standard_minutes: number;
  equipment_type: (typeof equipmentTypes)[number];
  transition_mode: "manual" | "timer";
  requires_operator_confirmation: boolean;
  category_codes: string[];
};

export function defaultProcedureStage(): ProcedureStageDraft {
  return {
    name: "清洗",
    standard_minutes: 45,
    equipment_type: "washer",
    transition_mode: "manual",
    requires_operator_confirmation: true,
    category_codes: [],
  };
}

export function serializeProcedureStages(stages: ProcedureStageDraft[]) {
  return JSON.stringify(
    stages.map((stage, index) => ({
      stage_order: index + 1,
      name: stage.name,
      standard_minutes: stage.standard_minutes,
      equipment_type: stage.equipment_type,
      compatibility_conditions:
        stage.category_codes.length > 0 ? { category_codes: stage.category_codes } : {},
      transition_mode: stage.transition_mode,
      requires_operator_confirmation: stage.requires_operator_confirmation,
    })),
  );
}
