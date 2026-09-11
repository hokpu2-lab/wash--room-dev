export const orderStatusLabels = {
  awaiting_receipt: "待收件",
  awaiting_cleaning: "待清洗",
  in_process: "處理中",
  ready_for_pickup: "待取件",
  picked_up: "已取件",
} as const;

export const batchStatusLabels = {
  not_started: "未開始",
  in_progress: "執行中",
  paused: "已暫停",
  completed: "已完成",
  failed: "失敗",
  cancelled: "取消",
  awaiting_cart: "待裝車",
  loaded: "已裝車",
} as const;

export const equipmentTypeLabels = {
  disinfection_tank: "消毒鍋",
  washer: "洗衣機",
  dryer: "烘衣機",
} as const;

export const equipmentStatusLabels = {
  normal: "可用",
  inactive: "停用",
  abnormal: "異常",
  maintenance: "維修中",
} as const;

export function orderStatusLabel(status: keyof typeof orderStatusLabels) {
  return orderStatusLabels[status];
}

export function nextControlHref(status: keyof typeof orderStatusLabels): string | null {
  switch (status) {
    case "awaiting_receipt":
      return "/app/operations/receive";
    case "awaiting_cleaning":
      return "/app/operations/washing";
    case "in_process":
      return "/app/operations/control-center";
    case "ready_for_pickup":
      return null;
    default:
      return "/app/dashboard";
  }
}
