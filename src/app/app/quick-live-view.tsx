"use client";

import React from "react";
import type {
  WorkspaceBatchDetail,
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

interface EquipmentLiveStatus {
  equipment: WorkspaceEquipment;
  statusLabel: string;
  statusTone: "disinfecting" | "washing" | "drying" | "completed" | "idle" | "paused";
  activeCartNumber: string | null;
  activeInstitutionName: string | null;
}

export function QuickLiveView({ orders, orderDetails, equipment }: QuickLiveViewProps) {
  // 1. 左側：待收件的洗衣車列表 (awaiting_receipt)
  const pendingReceiptOrders = orders.filter((o) => o.status === "awaiting_receipt");

  // 2. 右側：完成待取件的洗衣車列表 (ready_for_pickup)
  const readyForPickupOrders = orders.filter((o) => o.status === "ready_for_pickup");

  // 建立 orderId -> order 對照表
  const orderByIdMap = new Map<string, WorkspaceOrder>();
  const orderByNumberMap = new Map<string, WorkspaceOrder>();
  for (const order of orders) {
    orderByIdMap.set(order.id, order);
    orderByNumberMap.set(order.orderNumber, order);
  }

  // 3. 中間：各設備即時狀態推導
  // 將所有進行中或待處理的 batch stages 收集起來
  interface ActiveRunInfo {
    orderNumber: string;
    cartNumber: string;
    institutionName: string;
    stageType: "disinfection_tank" | "washer" | "dryer" | "manual" | "cart";
    stageName: string;
    stageState: "pending" | "active" | "completed";
    stageStatus: "in_progress" | "paused" | "completed" | "failed" | "cancelled" | null;
    activeEquipmentName: string | null;
    batchStatus: string;
  }

  const activeRuns: ActiveRunInfo[] = [];

  for (const detail of orderDetails) {
    const parentOrder = orderByIdMap.get(detail.orderId);
    for (const batch of detail.batches) {
      const orderNumber = parentOrder?.orderNumber ?? "";
      const cartNumber = parentOrder?.cartNumber ?? "";
      const institutionName = parentOrder?.institutionName ?? "";

      const activeStage = batch.stages.find((s) => s.state === "active");
      const currentStage =
        activeStage ??
        batch.stages.find((s) => s.stageOrder === batch.currentStageOrder) ??
        batch.stages[0];

      if (currentStage) {
        activeRuns.push({
          orderNumber,
          cartNumber,
          institutionName,
          stageType: currentStage.equipmentType,
          stageName: currentStage.name,
          stageState: currentStage.state,
          stageStatus: batch.progress.stageStatus,
          activeEquipmentName: batch.activeEquipmentName,
          batchStatus: batch.status,
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

  // 排序設備：消毒鍋 -> 洗衣機 -> 烘衣機 -> 名稱
  const typeOrder: Record<string, number> = {
    disinfection_tank: 1,
    washer: 2,
    dryer: 3,
  };

  const sortedEquipment = [...equipment].sort((a, b) => {
    const orderA = typeOrder[a.equipmentType] ?? 99;
    const orderB = typeOrder[b.equipmentType] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name, "zh-Hant");
  });

  const equipmentLiveList: EquipmentLiveStatus[] = sortedEquipment.map((eq) => {
    // 尋找關聯的 active run
    let match = activeRuns.find(
      (r) => r.activeEquipmentName === eq.name || (r.stageType === eq.equipmentType && eq.occupied)
    );

    // 容錯支援：如果本館消毒鍋被占用但 match 未找到，且有特殊消毒單
    if (!match && eq.equipmentType === "disinfection_tank" && eq.occupied && specialDisinfectOrders.length > 0) {
      const sp = specialDisinfectOrders[0];
      match = {
        orderNumber: sp.orderNumber,
        cartNumber: sp.cartNumber,
        institutionName: sp.institutionName,
        stageType: "disinfection_tank",
        stageName: "消毒浸泡",
        stageState: "active",
        stageStatus: "in_progress",
        activeEquipmentName: eq.name,
        batchStatus: "in_progress",
      };
    }

    if (match) {
      let statusLabel = "運作中";
      let statusTone: EquipmentLiveStatus["statusTone"] = "idle";

      if (eq.equipmentType === "disinfection_tank") {
        if (match.stageStatus === "paused") {
          statusLabel = "消毒暫停";
          statusTone = "paused";
        } else if (match.stageState === "completed" || match.stageStatus === "completed") {
          statusLabel = "消毒完畢";
          statusTone = "completed";
        } else {
          statusLabel = "消毒中";
          statusTone = "disinfecting";
        }
      } else if (eq.equipmentType === "washer") {
        if (match.stageStatus === "paused") {
          statusLabel = "清洗暫停";
          statusTone = "paused";
        } else if (match.stageState === "completed" || match.stageStatus === "completed") {
          statusLabel = "清洗完畢";
          statusTone = "completed";
        } else {
          statusLabel = "清洗中";
          statusTone = "washing";
        }
      } else if (eq.equipmentType === "dryer") {
        if (match.stageStatus === "paused") {
          statusLabel = "烘乾暫停";
          statusTone = "paused";
        } else if (match.stageState === "completed" || match.stageStatus === "completed") {
          statusLabel = "烘乾完畢";
          statusTone = "completed";
        } else {
          statusLabel = "烘乾中";
          statusTone = "drying";
        }
      }

      return {
        equipment: eq,
        statusLabel,
        statusTone,
        activeCartNumber: match.cartNumber || null,
        activeInstitutionName: match.institutionName || null,
      };
    }

    // 若設備本身 occupied 為 true，但未明確配對到特定 batch
    if (eq.occupied) {
      let defaultLabel = "使用中";
      let defaultTone: EquipmentLiveStatus["statusTone"] = "washing";
      if (eq.equipmentType === "disinfection_tank") {
        defaultLabel = "消毒中";
        defaultTone = "disinfecting";
      } else if (eq.equipmentType === "dryer") {
        defaultLabel = "烘乾中";
        defaultTone = "drying";
      } else {
        defaultLabel = "清洗中";
        defaultTone = "washing";
      }

      return {
        equipment: eq,
        statusLabel: defaultLabel,
        statusTone: defaultTone,
        activeCartNumber: null,
        activeInstitutionName: null,
      };
    }

    // 閒置設備
    const isAvailable = eq.status === "normal";
    return {
      equipment: eq,
      statusLabel: isAvailable ? "閒置待機" : "暫停服務",
      statusTone: "idle",
      activeCartNumber: null,
      activeInstitutionName: null,
    };
  });

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
        {/* === 左側：待收件洗衣車 === */}
        <div className={styles.liveViewCol}>
          <div className={styles.colHeader}>
            <span className={styles.colTitle}>📥 待收件洗衣車</span>
            <span className={styles.colCount}>{pendingReceiptOrders.length}</span>
          </div>
          <div className={styles.cartList}>
            {pendingReceiptOrders.length === 0 ? (
              <div className={styles.emptyState}>暫無待收件洗衣車</div>
            ) : (
              pendingReceiptOrders.map((order) => (
                <div
                  key={order.id}
                  className={styles.cartChip}
                  tabIndex={0}
                  role="tooltip"
                  aria-label={`${order.institutionName} - 車號 ${order.cartNumber}`}
                >
                  <span className={styles.cartIcon}>🛒</span>
                  <strong className={styles.cartNumber}>{order.cartNumber}</strong>
                  {/* Hover 浮動提示機構名稱 */}
                  <div className={styles.tooltipBox}>
                    <span className={styles.tooltipLabel}>機構名稱</span>
                    <span className={styles.tooltipValue}>{order.institutionName}</span>
                    <span className={styles.tooltipOrder}>單號 {order.orderNumber}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* === 中間：洗衣設備與運作動態 === */}
        <div className={`${styles.liveViewCol} ${styles.equipmentCol}`}>
          <div className={styles.colHeader}>
            <span className={styles.colTitle}>⚙️ 洗衣設備運作動態 (消毒 ➔ 清洗 ➔ 烘乾)</span>
            <span className={styles.colCount}>{equipmentLiveList.length} 台</span>
          </div>
          <div className={styles.equipmentGrid}>
            {equipmentLiveList.length === 0 ? (
              <div className={styles.emptyState}>暫無設備資料</div>
            ) : (
              equipmentLiveList.map((item) => {
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
              })
            )}
          </div>
        </div>

        {/* === 右側：洗烘完畢 待取件/待領回 === */}
        <div className={styles.liveViewCol}>
          <div className={styles.colHeader}>
            <span className={styles.colTitle}>📤 待取件 (洗烘完畢)</span>
            <span className={styles.colCount}>{readyForPickupOrders.length}</span>
          </div>
          <div className={styles.cartList}>
            {readyForPickupOrders.length === 0 ? (
              <div className={styles.emptyState}>暫無待取件洗衣車</div>
            ) : (
              readyForPickupOrders.map((order) => (
                <div
                  key={order.id}
                  className={`${styles.cartChip} ${styles.cartChipReady}`}
                  tabIndex={0}
                  role="tooltip"
                  aria-label={`${order.institutionName} - 車號 ${order.cartNumber}`}
                >
                  <span className={styles.cartIcon}>✨</span>
                  <strong className={styles.cartNumber}>{order.cartNumber}</strong>
                  {/* Hover 浮動提示機構名稱 */}
                  <div className={styles.tooltipBox}>
                    <span className={styles.tooltipLabel}>洗烘完畢 · 待領回</span>
                    <span className={styles.tooltipValue}>{order.institutionName}</span>
                    <span className={styles.tooltipOrder}>單號 {order.orderNumber}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
