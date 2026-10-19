export interface EquipmentStatusBadgeInfo {
  label: string;
  bg: string;
  border: string;
  color: string;
  icon: string;
}

export function getEquipmentStatusBadge(equipment: {
  status: string;
  equipment_type: string;
  occupied: boolean;
  active_cart_count?: number;
}): EquipmentStatusBadgeInfo {
  const isOccupied = Boolean(
    equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0)
  );

  if (equipment.status === "abnormal") {
    return {
      label: "異常故障",
      bg: "rgba(239, 68, 68, 0.15)",
      border: "rgba(239, 68, 68, 0.4)",
      color: "#f87171",
      icon: "⚠️",
    };
  }
  if (equipment.status === "maintenance") {
    return {
      label: "維修中",
      bg: "rgba(245, 158, 11, 0.15)",
      border: "rgba(245, 158, 11, 0.4)",
      color: "#fbbf24",
      icon: "🔧",
    };
  }
  if (equipment.status === "inactive") {
    return {
      label: "已停用",
      bg: "rgba(148, 163, 184, 0.12)",
      border: "rgba(148, 163, 184, 0.25)",
      color: "#94a3b8",
      icon: "⛔",
    };
  }

  // normal 狀態：依是否使用中及機型呈現即時作業狀態
  if (isOccupied) {
    if (equipment.equipment_type === "washer") {
      return {
        label: "清洗中",
        bg: "rgba(56, 189, 248, 0.15)",
        border: "rgba(56, 189, 248, 0.4)",
        color: "#38bdf8",
        icon: "💧",
      };
    }
    if (equipment.equipment_type === "dryer") {
      return {
        label: "烘乾中",
        bg: "rgba(251, 146, 60, 0.15)",
        border: "rgba(251, 146, 60, 0.4)",
        color: "#fb923c",
        icon: "🔥",
      };
    }
    if (equipment.equipment_type === "disinfection_tank") {
      return {
        label: "消毒中",
        bg: "rgba(192, 132, 252, 0.15)",
        border: "rgba(192, 132, 252, 0.4)",
        color: "#c084fc",
        icon: "🧪",
      };
    }
    return {
      label: "作業中",
      bg: "rgba(56, 189, 248, 0.15)",
      border: "rgba(56, 189, 248, 0.4)",
      color: "#38bdf8",
      icon: "⚡",
    };
  }

  return {
    label: "可使用",
    bg: "rgba(34, 197, 94, 0.15)",
    border: "rgba(34, 197, 94, 0.4)",
    color: "#4ade80",
    icon: "🟢",
  };
}
