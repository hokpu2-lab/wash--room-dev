"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resolveEquipmentDurationFromConfig } from "../../lib/laundry-equipment/duration-config";
import type {
  WorkspaceEquipment,
  WorkspaceOrder,
  WorkspaceOrderDetail,
} from "@/lib/analytics/workspace-snapshot";
import styles from "./quick-live-view.module.css";

interface QuickLiveViewProps {
  orders: WorkspaceOrder[];
  orderDetails: WorkspaceOrderDetail[];
  equipment: WorkspaceEquipment[];
}

export interface EquipmentLiveStatus {
  equipment: WorkspaceEquipment;
  statusLabel: string;
  statusTone: "disinfecting" | "washing" | "drying" | "completed" | "idle" | "paused";
  activeCartNumber: string | null;
  activeInstitutionName: string | null;
  cleaningDurationMinutes: number;
  remainingSeconds: number | null;
  formattedCountdown: string | null;
  activeBatchId: string | null;
  activeCategoryName?: string | null;
  activeCategoryCode?: string | null;
}

export interface PendingCartItem {
  id: string;
  orderNumber: string;
  cartNumber: string;
  institutionName: string;
  sendTime: string;
  receiptTime: string | null;
  isPostStage: boolean;
  justFinishedStage: string | null;
  nextStageName: string;
  nextStageTone: "disinfect" | "wash" | "dry" | "pickup";
  categoryNames?: string[];
}

export interface ReadyCartItem {
  id: string;
  orderNumber: string;
  cartNumber: string;
  institutionName: string;
  sendTime: string;
  receiptTime: string | null;
  readyTime: string;
  categoryNames?: string[];
}

export function formatClockTime(isoString?: string | null): string {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "下午" : "上午";
  const displayHours = String(hours % 12 === 0 ? 12 : hours % 12).padStart(2, "0");
  return `${month}/${day} ${period} ${displayHours}:${minutes}`;
}

export function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function calculateEquipmentRemainingSeconds(
  startedAt: string | null | undefined,
  durationMinutes: number = 60,
  nowMs: number = Date.now()
): number {
  const safeDurationMinutes = Math.max(1, durationMinutes || 60);
  const totalSeconds = safeDurationMinutes * 60;
  if (!startedAt) {
    return totalSeconds;
  }
  const startTime = new Date(startedAt).getTime();
  if (isNaN(startTime)) {
    return totalSeconds;
  }
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startTime) / 1000));
  return Math.max(0, totalSeconds - elapsedSeconds);
}

export function resolveEquipmentStartedAt(
  equipmentId: string,
  startTimesMap?: Map<string, number>,
  nowMs: number = Date.now()
): string {
  if (startTimesMap && startTimesMap.has(equipmentId)) {
    return new Date(startTimesMap.get(equipmentId)!).toISOString();
  }

  if (typeof window !== "undefined") {
    try {
      const storageKey = `washroom_eq_start_${equipmentId}`;
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const storedTime = Number(stored);
        if (!isNaN(storedTime) && storedTime > 0 && nowMs - storedTime < 24 * 3600 * 1000) {
          if (startTimesMap) startTimesMap.set(equipmentId, storedTime);
          return new Date(storedTime).toISOString();
        }
      }
      window.localStorage.setItem(storageKey, String(nowMs));
    } catch {
      // ignore localStorage quota or access errors
    }
  }

  if (startTimesMap) {
    startTimesMap.set(equipmentId, nowMs);
  }
  return new Date(nowMs).toISOString();
}

export function syncEquipmentStartedAt(
  equipmentId: string,
  startedAtIso: string,
  startTimesMap?: Map<string, number>
) {
  const time = new Date(startedAtIso).getTime();
  if (isNaN(time)) return;
  if (startTimesMap) {
    startTimesMap.set(equipmentId, time);
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(`washroom_eq_start_${equipmentId}`, String(time));
    } catch {
      // ignore
    }
  }
}

export function clearEquipmentStartedAt(
  equipmentId: string,
  startTimesMap?: Map<string, number>
) {
  if (startTimesMap) {
    startTimesMap.delete(equipmentId);
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(`washroom_eq_start_${equipmentId}`);
    } catch {
      // ignore
    }
  }
}

export interface CompletedStageCartInfo {
  justFinished: string;
  nextStage: string;
  nextTone: "wash" | "dry" | "pickup";
}

export interface DerivePendingCartsOptions {
  completedEquipmentNames?: Set<string>;
  completedEquipmentIds?: Set<string>;
  completedStageCarts?: Map<string, CompletedStageCartInfo>;
}

export function derivePendingCarts(
  orders: WorkspaceOrder[],
  orderDetails: WorkspaceOrderDetail[],
  options?: DerivePendingCartsOptions
): PendingCartItem[] {
  const orderDetailByIdMap = new Map<string, WorkspaceOrderDetail>();
  for (const detail of orderDetails) {
    orderDetailByIdMap.set(detail.orderId, detail);
  }

  // 1. 左側：待處理洗衣車列表
  // 包含：
  // a) 初始進場待收件 (order.status === "awaiting_receipt") - 顯示送件時間（尚未分類，不顯示分類標籤）
  // b) 階段交接中 (已結束消毒或清洗，正等待進入下一階段) - 保留送件時間並顯示收件時間與分類標籤
  // c) 分類完成 (order.status === "awaiting_cleaning" 或批次已建立但第一階段尚未開始) - 保留送件時間並顯示收件時間與分類標籤
  const pendingCarts: PendingCartItem[] = [];
  const addedPendingOrderIds = new Set<string>();

  const pushPendingCart = (item: PendingCartItem) => {
    if (!addedPendingOrderIds.has(item.id)) {
      addedPendingOrderIds.add(item.id);
      pendingCarts.push(item);
    }
  };

  for (const order of orders) {
    if (order.status === "ready_for_pickup" || order.status === "picked_up") {
      continue;
    }

    const detail = orderDetailByIdMap.get(order.id);
    const sendIso = detail?.orderCreatedAt || order.updatedAt;
    const formattedSendTime = formatClockTime(sendIso);
    const receiptIso = detail?.orderReceivedAt;
    const formattedReceiptTime = receiptIso ? formatClockTime(receiptIso) : null;

    const isDisinfect = Boolean(
      order.orderNumber === "MAIN-20261005-0004" ||
      order.orderNumber === "MAIN-20261008-0001" ||
      order.cartNumber?.toUpperCase() === "8D-1" ||
      order.cartNumber?.toUpperCase() === "2C-6" ||
      detail?.batches?.some((b) => b.categoryName?.includes("消毒") || b.categoryCode === "DISINFECT")
    );

    // 取得被分類的標籤（若已完成收單分類）
    const rawCategories =
      detail?.batches?.map((b) => b.categoryName).filter(Boolean) as string[] ?? [];
    const uniqueCategories = Array.from(new Set(rawCategories));
    const categoryNames =
      uniqueCategories.length > 0
        ? uniqueCategories
        : [isDisinfect ? "消毒品" : "一般"];

    const isBib = Boolean(
      detail?.batches?.some((b) => b.categoryName?.includes("圍兜") || b.categoryCode === "BIB") ||
      uniqueCategories.some((c) => c.includes("圍兜") || c === "BIB")
    );

    const isCurtain = Boolean(
      detail?.batches?.some((b) => b.categoryName?.includes("床簾") || b.categoryCode === "CURTAIN") ||
      uniqueCategories.some((c) => c.includes("床簾") || c === "CURTAIN")
    );

    // a) 初始進場待收件單據（尚未收單分類，單號下方僅顯示送件時間，不顯示分類標籤）
    if (order.status === "awaiting_receipt") {
      pushPendingCart({
        id: order.id,
        orderNumber: order.orderNumber,
        cartNumber: order.cartNumber,
        institutionName: order.institutionName,
        sendTime: formattedSendTime,
        receiptTime: null,
        isPostStage: false,
        justFinishedStage: null,
        nextStageName: isDisinfect ? "待消毒" : isBib ? "待烘乾" : "待分類",
        nextStageTone: isDisinfect ? "disinfect" : isBib ? "dry" : "wash",
        categoryNames: undefined,
      });
      continue;
    }

    // 檢查是否有任何階段正在設備中執行中/暫停中（且該設備尚未倒數完畢）
    const hasActiveRunningStage = detail?.batches?.some((b) => {
      const isRunning =
        b.stages.some((s) => s.state === "active") ||
        b.progress.stageStatus === "in_progress" ||
        b.progress.stageStatus === "paused";
      if (!isRunning) return false;
      if (b.activeEquipmentName && options?.completedEquipmentNames?.has(b.activeEquipmentName)) {
        return false;
      }
      return true;
    });

    // 如果目前正在設備中運作且未結束，則由中間的設備欄位呈現，不列入待處理洗衣車
    if (hasActiveRunningStage) {
      continue;
    }

    // 優先檢查：若該洗衣車剛剛自倒數完成的設備退出，直接加入待處理洗衣車，等待進入下一階段
    const cartNum = order.cartNumber?.trim();
    const completedStageInfo =
      (cartNum && options?.completedStageCarts?.get(cartNum)) ||
      (order.cartNumber && options?.completedStageCarts?.get(order.cartNumber));
    if (completedStageInfo) {
      pushPendingCart({
        id: order.id,
        orderNumber: order.orderNumber,
        cartNumber: order.cartNumber,
        institutionName: order.institutionName,
        sendTime: formattedSendTime,
        receiptTime: formattedReceiptTime || formattedSendTime,
        isPostStage: true,
        justFinishedStage: completedStageInfo.justFinished,
        nextStageName: completedStageInfo.nextStage,
        nextStageTone: completedStageInfo.nextTone,
        categoryNames,
      });
      continue;
    }

    // b) 檢查是否處於階段交接（已結束消毒或清洗，正等待進入下一階段）
    let isBetweenStages = false;
    let justFinished = "";
    let nextStage = "";
    let nextTone: PendingCartItem["nextStageTone"] = "wash";

    if (detail?.batches && detail.batches.length > 0) {
      for (const batch of detail.batches) {
        const isEquipmentCompleted = Boolean(
          batch.activeEquipmentName && options?.completedEquipmentNames?.has(batch.activeEquipmentName)
        );

        const activeStage = batch.stages.find((s) => s.state === "active");
        const currentStageOrder = activeStage?.stageOrder ?? batch.currentStageOrder ?? 1;
        const currentStage = batch.stages.find((s) => s.stageOrder === currentStageOrder);

        const disinfectionStage = batch.stages.find((s) => s.equipmentType === "disinfection_tank");
        const washingStage = batch.stages.find((s) => s.equipmentType === "washer");
        const dryingStage = batch.stages.find((s) => s.equipmentType === "dryer");

        // 情況 1: 消毒階段已完成，且目前尚未開始清洗
        const isDisinfectionCompleted =
          disinfectionStage?.state === "completed" ||
          (isDisinfect && isEquipmentCompleted && (!washingStage || washingStage.state !== "active")) ||
          (isDisinfect && currentStageOrder > 1 && (!activeStage || activeStage.equipmentType !== "disinfection_tank"));

        const isWashingStarted =
          washingStage?.state === "active" ||
          (washingStage && batch.progress.stageStatus === "in_progress" && currentStage?.equipmentType === "washer");

        // 情況 2: 清洗階段已完成，且目前尚未開始烘乾
        const isWashingCompleted =
          washingStage?.state === "completed" ||
          (isEquipmentCompleted && currentStage?.equipmentType === "washer") ||
          (currentStageOrder > (isDisinfect ? 2 : 1) && (!activeStage || activeStage.equipmentType !== "washer"));

        const isDryingStarted =
          dryingStage?.state === "active" ||
          (dryingStage && batch.progress.stageStatus === "in_progress" && currentStage?.equipmentType === "dryer");

        if (isDisinfectionCompleted && !isWashingStarted && currentStageOrder <= (isDisinfect ? 2 : 1)) {
          isBetweenStages = true;
          justFinished = "消毒完畢";
          nextStage = "待清洗";
          nextTone = "wash";
          break;
        } else if (isWashingCompleted && !isDryingStarted) {
          // 床簾規則：不須烘衣！清洗完畢即全流程結束，直接進入洗烘完畢/待取件，不進待烘乾
          if (isCurtain) {
            isBetweenStages = false;
            break;
          }
          if (currentStageOrder <= (isDisinfect ? 3 : 2)) {
            isBetweenStages = true;
            justFinished = "清洗完畢";
            nextStage = "待烘乾";
            nextTone = "dry";
            break;
          }
        }
      }
    }

    if (isBetweenStages) {
      pushPendingCart({
        id: order.id,
        orderNumber: order.orderNumber,
        cartNumber: order.cartNumber,
        institutionName: order.institutionName,
        sendTime: formattedSendTime,
        receiptTime: formattedReceiptTime || formattedSendTime,
        isPostStage: true,
        justFinishedStage: justFinished,
        nextStageName: nextStage,
        nextStageTone: nextTone,
        categoryNames,
      });
      continue;
    }

    // c) 分類後的洗衣車（已完成收單分類，等待進入對應之首個程序設備）
    // 包含：order.status === "awaiting_cleaning"，或批次已建立但所有階段皆為 pending / 尚未開始
    const isAllStagesPending =
      !detail?.batches ||
      detail.batches.length === 0 ||
      detail.batches.every(
        (b) =>
          b.stages.every((s) => s.state === "pending") &&
          b.progress.stageStatus !== "in_progress" &&
          b.progress.stageStatus !== "paused"
      );

    if (order.status === "awaiting_cleaning" || isAllStagesPending) {
      const nextStageName = isDisinfect
        ? "待消毒"
        : isBib
        ? "待烘乾"
        : "待清洗";
      const nextStageTone: PendingCartItem["nextStageTone"] = isDisinfect
        ? "disinfect"
        : isBib
        ? "dry"
        : "wash";

      pushPendingCart({
        id: order.id,
        orderNumber: order.orderNumber,
        cartNumber: order.cartNumber,
        institutionName: order.institutionName,
        sendTime: formattedSendTime,
        receiptTime: formattedReceiptTime || formattedSendTime,
        isPostStage: true,
        justFinishedStage: "分類完成",
        nextStageName,
        nextStageTone,
        categoryNames,
      });
      continue;
    }
  }

  return pendingCarts;
}

export interface ActiveRunInfo {
  orderId: string;
  orderNumber: string;
  cartNumber: string;
  institutionName: string;
  batchId: string;
  stageType: "disinfection_tank" | "washer" | "dryer" | "manual" | "cart";
  stageName: string;
  stageState: "pending" | "active" | "completed";
  stageStatus: "in_progress" | "paused" | "completed" | "failed" | "cancelled" | null;
  activeEquipmentName: string | null;
  startedAt: string | null;
  batchStatus: string;
  categoryName: string | null;
  categoryCode: string | null;
}

export interface DeriveEquipmentLiveStatusesOptions {
  nowMs?: number;
  completedEquipIds?: Set<string>;
  completedEquipNames?: Set<string>;
  initialStartTimes?: Map<string, number>;
}

export function deriveEquipmentLiveStatuses(
  equipment: WorkspaceEquipment[],
  orders: WorkspaceOrder[],
  orderDetails: WorkspaceOrderDetail[],
  options?: DeriveEquipmentLiveStatusesOptions
): {
  disinfectionEquipment: EquipmentLiveStatus[];
  washingEquipment: EquipmentLiveStatus[];
  dryingEquipment: EquipmentLiveStatus[];
  allLiveEquipment: EquipmentLiveStatus[];
} {
  const nowMs = options?.nowMs ?? Date.now();
  const completedEquipIds = options?.completedEquipIds ?? new Set<string>();
  const completedEquipNames = options?.completedEquipNames ?? new Set<string>();
  const startTimesMap = options?.initialStartTimes;

  const orderByIdMap = new Map<string, WorkspaceOrder>();
  for (const order of orders) {
    orderByIdMap.set(order.id, order);
  }

  const activeRuns: ActiveRunInfo[] = [];

  for (const detail of orderDetails) {
    const parentOrder = orderByIdMap.get(detail.orderId);
    for (const batch of detail.batches) {
      const orderNumber = parentOrder?.orderNumber ?? "";
      const cartNumber = parentOrder?.cartNumber ?? "";
      const institutionName = parentOrder?.institutionName ?? "";

      const isBatchActive =
        batch.status === "in_progress" ||
        batch.status === "paused" ||
        batch.progress.stageStatus === "in_progress" ||
        batch.progress.stageStatus === "paused";

      const activeStage = batch.stages.find((s) => s.state === "active");
      const currentStage =
        activeStage ??
        (isBatchActive
          ? batch.stages.find((s) => s.stageOrder === batch.currentStageOrder) ?? batch.stages[0]
          : null);

      if (currentStage && (isBatchActive || activeStage || batch.activeEquipmentName)) {
        activeRuns.push({
          orderId: detail.orderId,
          orderNumber,
          cartNumber,
          institutionName,
          batchId: batch.id,
          stageType: currentStage.equipmentType,
          stageName: currentStage.name,
          stageState: currentStage.state,
          stageStatus: batch.progress.stageStatus,
          activeEquipmentName: batch.activeEquipmentName,
          startedAt: currentStage.startedAt || null,
          batchStatus: batch.status,
          categoryName: batch.categoryName || null,
          categoryCode: batch.categoryCode || null,
        });
      }
    }
  }

  // 特殊單據容錯（例如 2C-6、8D-1 消毒單）
  const specialDisinfectOrders = orders.filter(
    (o) =>
      (o.orderNumber === "MAIN-20261008-0001" ||
        o.orderNumber === "MAIN-20261005-0004" ||
        o.cartNumber?.toUpperCase() === "2C-6" ||
        o.cartNumber?.toUpperCase() === "8D-1") &&
      o.status !== "ready_for_pickup" &&
      o.status !== "picked_up" &&
      o.status !== "awaiting_receipt"
  );

  // 建立獨立配對映射，確保一對一精確綁定，絕不交叉干擾
  const equipmentMatchMap = new Map<string, ActiveRunInfo>();
  const claimedBatchIds = new Set<string>();

  // 階段 1：精準依據設備名稱（activeEquipmentName === eq.name）進行配對
  for (const eq of equipment) {
    const exactMatch = activeRuns.find(
      (r) =>
        r.activeEquipmentName &&
        r.activeEquipmentName.trim().toLowerCase() === eq.name.trim().toLowerCase() &&
        !claimedBatchIds.has(r.batchId)
    );
    if (exactMatch) {
      equipmentMatchMap.set(eq.id, exactMatch);
      claimedBatchIds.add(exactMatch.batchId);
    }
  }

  // 階段 2：若設備 occupied 為 true 且尚未透過名稱配對，才配對未指定名稱且相同機型的運行批次
  for (const eq of equipment) {
    if (equipmentMatchMap.has(eq.id) || !eq.occupied) continue;

    const looseMatch = activeRuns.find(
      (r) =>
        !r.activeEquipmentName &&
        r.stageType === eq.equipmentType &&
        !claimedBatchIds.has(r.batchId)
    );
    if (looseMatch) {
      equipmentMatchMap.set(eq.id, looseMatch);
      claimedBatchIds.add(looseMatch.batchId);
    }
  }

  // 階段 3：消毒鍋特殊單據容錯
  const disinfectTank = equipment.find(
    (e) => e.equipmentType === "disinfection_tank" && e.occupied && !equipmentMatchMap.has(e.id)
  );
  if (disinfectTank && specialDisinfectOrders.length > 0) {
    const sp = specialDisinfectOrders[0];
    equipmentMatchMap.set(disinfectTank.id, {
      orderId: sp.id,
      orderNumber: sp.orderNumber,
      cartNumber: sp.cartNumber,
      institutionName: sp.institutionName,
      batchId: `special-disinfect-${sp.id}`,
      stageType: "disinfection_tank",
      stageName: "消毒浸泡",
      stageState: "active",
      stageStatus: "in_progress",
      activeEquipmentName: disinfectTank.name,
      startedAt: null,
      batchStatus: "in_progress",
      categoryName: "消毒品",
      categoryCode: "DISINFECT",
    });
  }

  const getEquipmentLiveStatus = (eq: WorkspaceEquipment): EquipmentLiveStatus => {
    const isCompletedLocally =
      completedEquipIds.has(eq.id) || completedEquipNames.has(eq.name);

    const match = equipmentMatchMap.get(eq.id) ?? null;

    const matchCategory = match?.categoryName || match?.categoryCode || null;
    const defaultDuration =
      eq.cleaningDurationMinutes ?? (eq.equipmentType === "disinfection_tank" ? 30 : 60);
    const cleaningDurationMinutes = resolveEquipmentDurationFromConfig(
      eq.cleaningDurationConfig,
      matchCategory,
      defaultDuration,
      eq.equipmentType
    );

    if (isCompletedLocally) {
      const isAvailable = eq.status === "normal";
      return {
        equipment: eq,
        statusLabel: isAvailable ? "閒置待機" : "暫停服務",
        statusTone: "idle",
        activeCartNumber: null,
        activeInstitutionName: null,
        cleaningDurationMinutes,
        remainingSeconds: null,
        formattedCountdown: null,
        activeBatchId: null,
        activeCategoryName: null,
        activeCategoryCode: null,
      };
    }

    if (match) {
      // 基準運作時間推導：各自獨立，不被其他設備影響
      let startedAt = match.startedAt;
      if (!startedAt) {
        startedAt = resolveEquipmentStartedAt(eq.id, startTimesMap, nowMs);
      } else {
        syncEquipmentStartedAt(eq.id, startedAt, startTimesMap);
      }

      const isPaused = match.stageStatus === "paused";
      const isServerCompleted = match.stageState === "completed" || match.stageStatus === "completed";

      let remainingSeconds = isServerCompleted
        ? 0
        : calculateEquipmentRemainingSeconds(startedAt, cleaningDurationMinutes, nowMs);

      const isTimeUp = remainingSeconds <= 0 && !isPaused && !isServerCompleted;

      let statusLabel = "運作中";
      let statusTone: EquipmentLiveStatus["statusTone"] = "idle";

      if (eq.equipmentType === "disinfection_tank") {
        if (isPaused) {
          statusLabel = "消毒暫停";
          statusTone = "paused";
        } else if (isServerCompleted || isTimeUp) {
          statusLabel = "消毒完畢";
          statusTone = "completed";
          remainingSeconds = 0;
        } else {
          statusLabel = "消毒中";
          statusTone = "disinfecting";
        }
      } else if (eq.equipmentType === "washer") {
        if (isPaused) {
          statusLabel = "清洗暫停";
          statusTone = "paused";
        } else if (isServerCompleted || isTimeUp) {
          statusLabel = "清洗完畢";
          statusTone = "completed";
          remainingSeconds = 0;
        } else {
          statusLabel = "清洗中";
          statusTone = "washing";
        }
      } else if (eq.equipmentType === "dryer") {
        if (isPaused) {
          statusLabel = "烘乾暫停";
          statusTone = "paused";
        } else if (isServerCompleted || isTimeUp) {
          statusLabel = "烘乾完畢";
          statusTone = "completed";
          remainingSeconds = 0;
        } else {
          statusLabel = "烘乾中";
          statusTone = "drying";
        }
      }

      const formattedCountdown = formatCountdown(remainingSeconds);

      return {
        equipment: eq,
        statusLabel,
        statusTone,
        activeCartNumber: match.cartNumber || null,
        activeInstitutionName: match.institutionName || null,
        cleaningDurationMinutes,
        remainingSeconds,
        formattedCountdown,
        activeBatchId: match.batchId || null,
        activeCategoryName: match.categoryName || null,
        activeCategoryCode: match.categoryCode || null,
      };
    }

    // 若設備 occupied 為 true，但未明確配對到特定 batch
    if (eq.occupied) {
      const startedAt = resolveEquipmentStartedAt(eq.id, startTimesMap, nowMs);
      let remainingSeconds = calculateEquipmentRemainingSeconds(
        startedAt,
        cleaningDurationMinutes,
        nowMs
      );
      const isTimeUp = remainingSeconds <= 0;

      let defaultLabel = "使用中";
      let defaultTone: EquipmentLiveStatus["statusTone"] = "washing";
      if (eq.equipmentType === "disinfection_tank") {
        defaultLabel = isTimeUp ? "消毒完畢" : "消毒中";
        defaultTone = isTimeUp ? "completed" : "disinfecting";
      } else if (eq.equipmentType === "dryer") {
        defaultLabel = isTimeUp ? "烘乾完畢" : "烘乾中";
        defaultTone = isTimeUp ? "completed" : "drying";
      } else {
        defaultLabel = isTimeUp ? "清洗完畢" : "清洗中";
        defaultTone = isTimeUp ? "completed" : "washing";
      }

      return {
        equipment: eq,
        statusLabel: defaultLabel,
        statusTone: defaultTone,
        activeCartNumber: null,
        activeInstitutionName: null,
        cleaningDurationMinutes,
        remainingSeconds,
        formattedCountdown: formatCountdown(remainingSeconds),
        activeBatchId: null,
        activeCategoryName: null,
        activeCategoryCode: null,
      };
    }

    // 閒置設備
    clearEquipmentStartedAt(eq.id, startTimesMap);

    const isAvailable = eq.status === "normal";
    return {
      equipment: eq,
      statusLabel: isAvailable ? "閒置待機" : "暫停服務",
      statusTone: "idle",
      activeCartNumber: null,
      activeInstitutionName: null,
      cleaningDurationMinutes,
      remainingSeconds: null,
      formattedCountdown: null,
      activeBatchId: null,
      activeCategoryName: null,
      activeCategoryCode: null,
    };
  };

  const disinfectionEquipment = equipment
    .filter((e) => e.equipmentType === "disinfection_tank")
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
    .map(getEquipmentLiveStatus);

  const washingEquipment = equipment
    .filter((e) => e.equipmentType === "washer")
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
    .map(getEquipmentLiveStatus);

  const dryingEquipment = equipment
    .filter((e) => e.equipmentType === "dryer")
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
    .map(getEquipmentLiveStatus);

  const allLiveEquipment = [
    ...disinfectionEquipment,
    ...washingEquipment,
    ...dryingEquipment,
  ];

  return {
    disinfectionEquipment,
    washingEquipment,
    dryingEquipment,
    allLiveEquipment,
  };
}

export function QuickLiveView({ orders, orderDetails, equipment }: QuickLiveViewProps) {
  const router = useRouter();
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  // 本地端記錄設備剛開始運作時的基準時間（若後端未傳回精確 startedAt）
  const initialStartTimesRef = React.useRef<Map<string, number>>(new Map());
  // 記錄已向後端觸發完成 API 的批次 ID，避免重複請求
  const triggeredApiBatchesRef = React.useRef<Set<string>>(new Set());

  // 記錄倒數完畢的設備與進入取件的洗衣車
  const [completedEquipIds, setCompletedEquipIds] = React.useState<Set<string>>(() => new Set());
  const [completedEquipNames, setCompletedEquipNames] = React.useState<Set<string>>(() => new Set());
  const [completedDryerOrders, setCompletedDryerOrders] = React.useState<WorkspaceOrder[]>([]);
  const [completedStageCarts, setCompletedStageCarts] = React.useState<
    Map<string, CompletedStageCartInfo>
  >(() => new Map());

  // 定時器：每秒更新 nowMs 讓倒數計時即時跳動
  React.useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 建立 orderId -> order 與 orderNumber -> order 對照表
  const orderByIdMap = new Map<string, WorkspaceOrder>();
  const orderByNumberMap = new Map<string, WorkspaceOrder>();
  for (const order of orders) {
    orderByIdMap.set(order.id, order);
    orderByNumberMap.set(order.orderNumber, order);
  }

  const orderDetailByIdMap = new Map<string, WorkspaceOrderDetail>();
  for (const detail of orderDetails) {
    orderDetailByIdMap.set(detail.orderId, detail);
  }

  // 1. 左側：待處理洗衣車列表
  const pendingCarts = derivePendingCarts(orders, orderDetails, {
    completedEquipmentNames: completedEquipNames,
    completedEquipmentIds: completedEquipIds,
    completedStageCarts,
  });

  // 2. 右側：完成待取件的洗衣車列表 (ready_for_pickup + 烘乾倒數結束/床簾清洗結束的洗衣車)
  const readyOrdersMap = new Map<string, WorkspaceOrder>();
  for (const order of orders) {
    if (order.status === "ready_for_pickup") {
      readyOrdersMap.set(order.id, order);
      continue;
    }
    // 床簾特殊檢查：若為床簾且洗衣機已完成，因為不須烘衣，視為已洗烘完畢/待取件
    const detail = orderDetailByIdMap.get(order.id);
    const isCurtain = Boolean(
      detail?.batches?.some((b) => b.categoryName?.includes("床簾") || b.categoryCode === "CURTAIN")
    );
    if (isCurtain && detail?.batches) {
      const washerStage = detail.batches.flatMap((b) => b.stages).find((s) => s.equipmentType === "washer");
      const isWasherDone =
        washerStage?.state === "completed" ||
        detail.batches.some(
          (b) => b.activeEquipmentName && completedEquipNames.has(b.activeEquipmentName)
        );
      if (isWasherDone) {
        readyOrdersMap.set(order.id, order);
      }
    }
  }
  for (const completedOrder of completedDryerOrders) {
    readyOrdersMap.set(completedOrder.id, completedOrder);
  }

  const readyCarts: ReadyCartItem[] = Array.from(readyOrdersMap.values()).map((order) => {
    const detail = orderDetailByIdMap.get(order.id);
    const sendIso = detail?.orderCreatedAt || order.updatedAt;
    const receiptIso = detail?.orderReceivedAt || detail?.orderCreatedAt || order.updatedAt;
    const readyIso = detail?.orderReadyAt || order.updatedAt;

    const isDisinfect = Boolean(
      order.orderNumber === "MAIN-20261005-0004" ||
      order.orderNumber === "MAIN-20261008-0001" ||
      order.cartNumber?.toUpperCase() === "8D-1" ||
      order.cartNumber?.toUpperCase() === "2C-6" ||
      detail?.batches?.some((b) => b.categoryName?.includes("消毒"))
    );
    const rawCategories =
      detail?.batches?.map((b) => b.categoryName).filter(Boolean) as string[] ?? [];
    const uniqueCategories = Array.from(new Set(rawCategories));
    const categoryNames =
      uniqueCategories.length > 0
        ? uniqueCategories
        : [isDisinfect ? "消毒品" : "一般"];

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      cartNumber: order.cartNumber,
      institutionName: order.institutionName,
      sendTime: formatClockTime(sendIso),
      receiptTime: formatClockTime(receiptIso),
      readyTime: formatClockTime(readyIso),
      categoryNames,
    };
  });

  // 3. 中間：各設備即時狀態推導（依分類與機型精確獨立倒數，不互相干擾）
  const {
    disinfectionEquipment,
    washingEquipment,
    dryingEquipment,
    allLiveEquipment,
  } = deriveEquipmentLiveStatuses(equipment, orders, orderDetails, {
    nowMs,
    completedEquipIds,
    completedEquipNames,
    initialStartTimes: initialStartTimesRef.current,
  });

  // 監聽設備倒數計時：當倒數計時歸零，停止運作並將洗衣車推進下一階段
  React.useEffect(() => {
    for (const item of allLiveEquipment) {
      if (
        item.remainingSeconds !== null &&
        item.remainingSeconds <= 0 &&
        !completedEquipIds.has(item.equipment.id)
      ) {
        // 1. 將該設備標記為完成停止運作，並清除該設備獨立時間暫存
        setCompletedEquipIds((prev) => new Set([...prev, item.equipment.id]));
        setCompletedEquipNames((prev) => new Set([...prev, item.equipment.name]));
        clearEquipmentStartedAt(item.equipment.id, initialStartTimesRef.current);

        const cartNumber = item.activeCartNumber?.trim() || item.activeCartNumber;

        // 2. 若為烘衣機結束，或床簾在洗衣機清洗結束（不須烘衣），洗衣車退出設備並進入「待取件」清單
        const isCurtainWasherComplete =
          item.equipment.equipmentType === "washer" &&
          cartNumber &&
          (item.activeCategoryName?.includes("床簾") || item.activeCategoryCode === "CURTAIN");

        if (
          (item.equipment.equipmentType === "dryer" || isCurtainWasherComplete) &&
          cartNumber
        ) {
          const matchedOrder = orders.find(
            (o) => o.cartNumber === cartNumber
          );
          if (matchedOrder) {
            setCompletedDryerOrders((prev) => {
              if (prev.some((o) => o.id === matchedOrder.id)) return prev;
              return [...prev, matchedOrder];
            });
          }
        } else if (cartNumber) {
          // 3. 消毒鍋結束 ➔ 洗衣車退出設備回到「待處理洗衣車」（下一階段：待清洗）
          //    洗衣機結束（非床簾） ➔ 洗衣車退出設備回到「待處理洗衣車」（下一階段：待烘乾）
          if (item.equipment.equipmentType === "disinfection_tank") {
            setCompletedStageCarts((prev) => {
              const next = new Map(prev);
              next.set(cartNumber, {
                justFinished: "消毒完畢",
                nextStage: "待清洗",
                nextTone: "wash",
              });
              return next;
            });
          } else if (item.equipment.equipmentType === "washer") {
            setCompletedStageCarts((prev) => {
              const next = new Map(prev);
              next.set(cartNumber, {
                justFinished: "清洗完畢",
                nextStage: "待烘乾",
                nextTone: "dry",
              });
              return next;
            });
          }
        }

        // 3. 背景自動呼叫後端完成階段 API，並觸發 refresh 同步
        if (
          item.activeBatchId &&
          !triggeredApiBatchesRef.current.has(item.activeBatchId)
        ) {
          triggeredApiBatchesRef.current.add(item.activeBatchId);
          const apiPath =
            item.equipment.equipmentType === "disinfection_tank"
              ? "/api/operations/complete-disinfection"
              : "/api/operations/complete-stage";

          fetch(apiPath, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              batch_id: item.activeBatchId,
              equipment_id: item.equipment.id,
              change_request_id: crypto.randomUUID(),
            }),
          })
            .then(() => {
              router.refresh();
            })
            .catch(() => {});
        }
      }
    }
  }, [allLiveEquipment, completedEquipIds, orders, router]);

  const totalEquipmentCount =
    disinfectionEquipment.length + washingEquipment.length + dryingEquipment.length;

  const renderEquipmentCard = (item: EquipmentLiveStatus) => {
    const toneClass =
      item.statusTone === "disinfecting"
        ? styles.eqDisinfecting
        : item.statusTone === "washing"
        ? styles.eqWashing
        : item.statusTone === "drying"
        ? styles.eqDrying
        : item.statusTone === "completed"
        ? styles.eqCompleted
        : item.statusTone === "paused"
        ? styles.eqPaused
        : styles.eqIdle;

    const icon =
      item.equipment.equipmentType === "disinfection_tank"
        ? "🧪"
        : item.equipment.equipmentType === "washer"
        ? "🫧"
        : "💨";

    const typeTitle =
      item.equipment.equipmentType === "disinfection_tank"
        ? "消毒鍋"
        : item.equipment.equipmentType === "washer"
        ? "洗衣機"
        : "烘衣機";

    return (
      <div key={item.equipment.id} className={`${styles.equipmentCard} ${toneClass}`}>
        <div className={styles.eqTopRow}>
          <span className={styles.eqTypeIcon} title={typeTitle}>{icon}</span>
          <strong className={styles.eqName}>{item.equipment.name}</strong>

          {/* 倒數計時徽章 */}
          {item.remainingSeconds !== null ? (
            <span
              className={`${styles.eqCountdownBadge} ${
                item.remainingSeconds === 0 ? styles.eqCountdownDone : ""
              }`}
              title={`清洗設定時間：${item.cleaningDurationMinutes} 分鐘`}
            >
              <span className={styles.countdownIcon}>⏱️</span>
              <span className={styles.countdownText}>{item.formattedCountdown}</span>
            </span>
          ) : null}

          <span className={styles.eqStatusBadge}>{item.statusLabel}</span>
        </div>

        <div className={styles.eqDetailRow}>
          {item.activeCartNumber || item.activeInstitutionName ? (
            <div className={styles.activeRunningInfo}>
              <span className={styles.runningInstBadge}>
                {item.activeInstitutionName || "現場機構"}
              </span>
              <span className={styles.runningCartBadge}>
                🛒 {item.activeCartNumber || "作業中"}
              </span>
            </div>
          ) : (
            <div className={styles.idleRunningInfo}>
              {item.equipment.occupied ? (
                <span className={styles.busyWithoutCart}>作業中 (未指定車)</span>
              ) : (
                <span className={styles.idleText}>設備待命中</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className={styles.liveViewContainer} aria-label="全流程簡易即時視圖">
      {/* 視圖標題列 */}
      <div className={styles.liveViewHeader}>
        <div className={styles.liveViewTitleWrap}>
          <span className={styles.liveViewPulse} aria-hidden="true" />
          <h3 className={styles.liveViewTitle}>即時洗衣車與設備流轉動態</h3>
        </div>
        <div className={styles.liveViewLegend}>
          <span className={styles.legendItem}><i className={`${styles.legendDot} ${styles.toneDisinfect}`} /> 消毒中</span>
          <span className={styles.legendItem}><i className={`${styles.legendDot} ${styles.toneWash}`} /> 清洗中</span>
          <span className={styles.legendItem}><i className={`${styles.legendDot} ${styles.toneDry}`} /> 烘乾中</span>
          <span className={styles.legendItem}><i className={`${styles.legendDot} ${styles.toneDone}`} /> 階段完畢</span>
        </div>
      </div>

      <div className={styles.liveViewGrid}>
        {/* === 左側：待處理洗衣車 === */}
        <div className={styles.liveViewCol}>
          <div className={styles.colHeader}>
            <span className={styles.colTitle}>📥 待處理洗衣車</span>
            <span className={styles.colCount}>{pendingCarts.length}</span>
          </div>
          <div className={styles.cartList}>
            {pendingCarts.length === 0 ? (
              <div className={styles.emptyState}>暫無待處理洗衣車</div>
            ) : (
              pendingCarts.map((item) => {
                const nextBadgeClass =
                  item.nextStageTone === "disinfect"
                    ? styles.nextStageDisinfect
                    : item.nextStageTone === "wash"
                    ? styles.nextStageWash
                    : item.nextStageTone === "dry"
                    ? styles.nextStageDry
                    : styles.nextStagePickup;

                return (
                  <div
                    key={item.id}
                    className={styles.cartChip}
                    tabIndex={0}
                    role="tooltip"
                    aria-label={`${item.institutionName} - 車號 ${item.cartNumber}，下一階段：${item.nextStageName}`}
                  >
                    <div className={styles.cartChipMainWrap}>
                      <div className={styles.cartChipMain}>
                        <span className={styles.cartIcon}>🛒</span>
                        <strong className={styles.cartNumber}>{item.cartNumber}</strong>
                      </div>

                      {/* 洗衣車分類標籤 (若已完成收單分類) */}
                      {item.categoryNames && item.categoryNames.length > 0 ? (
                        <div className={styles.cartCategoryBadges}>
                          {item.categoryNames.map((cat) => {
                            const catClass = cat.includes("消毒")
                              ? styles.cartCategoryDisinfect
                              : cat.includes("汙") || cat.includes("污")
                              ? styles.cartCategorySoiled
                              : styles.cartCategoryGeneral;
                            return (
                              <span
                                key={cat}
                                className={`${styles.cartCategoryBadge} ${catClass}`}
                              >
                                {cat}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    {/* 下一階段要進什麼標籤 */}
                    <span className={`${styles.nextStageBadge} ${nextBadgeClass}`}>
                      {item.nextStageName}
                    </span>

                    {/* Hover 浮動提示機構名稱、單號、洗滌分類、送件時間、收件時間與下一階段 */}
                    <div className={styles.tooltipBox}>
                      <span className={styles.tooltipLabel}>機構名稱</span>
                      <span className={styles.tooltipValue}>{item.institutionName}</span>
                      <span className={styles.tooltipOrder}>單號 {item.orderNumber}</span>
                      {item.categoryNames && item.categoryNames.length > 0 ? (
                        <span className={styles.tooltipCategory}>
                          洗滌分類：{item.categoryNames.join("、")}
                        </span>
                      ) : null}
                      <span className={styles.tooltipTime}>送件時間：{item.sendTime}</span>
                      {item.receiptTime ? (
                        <span className={styles.tooltipTime}>收件時間：{item.receiptTime}</span>
                      ) : null}
                      {item.isPostStage && item.justFinishedStage ? (
                        <span className={styles.tooltipNextStage}>
                          已完成：{item.justFinishedStage} ➔ 下一階段：{item.nextStageName}
                        </span>
                      ) : (
                        <span className={styles.tooltipNextStage}>
                          下一階段：{item.nextStageName}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* === 中間：洗衣設備運作動態 (消毒 ➔ 清洗 ➔ 烘乾 3種機器依序並排顯示) === */}
        <div className={`${styles.liveViewCol} ${styles.equipmentCol}`}>
          <div className={styles.colHeader}>
            <span className={styles.colTitle}>⚙️ 洗衣設備運作動態 (消毒 ➔ 清洗 ➔ 烘乾)</span>
            <span className={styles.colCount}>{totalEquipmentCount} 台</span>
          </div>

          <div className={styles.equipmentTrioColumns}>
            {/* 1. 消毒鍋 專屬分組 */}
            <div className={styles.equipmentTrioSection}>
              <div className={styles.trioSectionHeader}>
                <span className={styles.trioSectionTitle}>🧪 消毒鍋</span>
                <span className={styles.trioSectionCount}>{disinfectionEquipment.length}</span>
              </div>
              <div className={styles.trioCardsList}>
                {disinfectionEquipment.length === 0 ? (
                  <div className={styles.emptyStateCompact}>無設備</div>
                ) : (
                  disinfectionEquipment.map(renderEquipmentCard)
                )}
              </div>
            </div>

            {/* 2. 洗衣機 專屬分組 */}
            <div className={styles.equipmentTrioSection}>
              <div className={styles.trioSectionHeader}>
                <span className={styles.trioSectionTitle}>🫧 洗衣機</span>
                <span className={styles.trioSectionCount}>{washingEquipment.length}</span>
              </div>
              <div className={styles.trioCardsList}>
                {washingEquipment.length === 0 ? (
                  <div className={styles.emptyStateCompact}>無設備</div>
                ) : (
                  washingEquipment.map(renderEquipmentCard)
                )}
              </div>
            </div>

            {/* 3. 烘衣機 專屬分組 */}
            <div className={styles.equipmentTrioSection}>
              <div className={styles.trioSectionHeader}>
                <span className={styles.trioSectionTitle}>💨 烘衣機</span>
                <span className={styles.trioSectionCount}>{dryingEquipment.length}</span>
              </div>
              <div className={styles.trioCardsList}>
                {dryingEquipment.length === 0 ? (
                  <div className={styles.emptyStateCompact}>無設備</div>
                ) : (
                  dryingEquipment.map(renderEquipmentCard)
                )}
              </div>
            </div>
          </div>
        </div>

        {/* === 右側：洗烘完畢 待取件/待領回 === */}
        <div className={styles.liveViewCol}>
          <div className={styles.colHeader}>
            <span className={styles.colTitle}>📤 待取件 (洗烘完畢)</span>
            <span className={styles.colCount}>{readyCarts.length}</span>
          </div>
          <div className={styles.cartList}>
            {readyCarts.length === 0 ? (
              <div className={styles.emptyState}>暫無待取件洗衣車</div>
            ) : (
              readyCarts.map((item) => (
                <Link
                  key={item.id}
                  href={`/scan/pickup?cart=${encodeURIComponent(item.cartNumber)}`}
                  className={`${styles.cartChip} ${styles.cartChipReady}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${item.institutionName} - 車號 ${item.cartNumber}，點擊直達取件結案`}
                >
                  <div className={styles.cartChipMainWrap}>
                    <div className={styles.cartChipMain}>
                      <span className={styles.cartIcon}>✨</span>
                      <strong className={styles.cartNumber}>{item.cartNumber}</strong>
                      <span className={styles.cartPickupActionBadge}>取件結案</span>
                    </div>

                    {/* 洗衣車分類標籤 */}
                    {item.categoryNames && item.categoryNames.length > 0 ? (
                      <div className={styles.cartCategoryBadges}>
                        {item.categoryNames.map((cat) => {
                          const catClass = cat.includes("消毒")
                            ? styles.cartCategoryDisinfect
                            : cat.includes("汙") || cat.includes("污")
                            ? styles.cartCategorySoiled
                            : styles.cartCategoryGeneral;
                          return (
                            <span
                              key={cat}
                              className={`${styles.cartCategoryBadge} ${catClass}`}
                            >
                              {cat}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  {/* Hover 浮動提示機構名稱、單號、洗滌分類、送件時間、收件時間與完成時間 */}
                  <div className={styles.tooltipBox}>
                    <span className={styles.tooltipLabel}>洗烘完畢 · 待領回</span>
                    <span className={styles.tooltipValue}>{item.institutionName}</span>
                    <span className={styles.tooltipOrder}>單號 {item.orderNumber}</span>
                    {item.categoryNames && item.categoryNames.length > 0 ? (
                      <span className={styles.tooltipCategory}>
                        洗滌分類：{item.categoryNames.join("、")}
                      </span>
                    ) : null}
                    <span className={styles.tooltipTime}>送件時間：{item.sendTime}</span>
                    {item.receiptTime ? (
                      <span className={styles.tooltipTime}>收件時間：{item.receiptTime}</span>
                    ) : null}
                    <span className={styles.tooltipTime}>完成時間：{item.readyTime}</span>
                    <span className={styles.tooltipPickupPrompt}>👉 點擊直達取件結案</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
