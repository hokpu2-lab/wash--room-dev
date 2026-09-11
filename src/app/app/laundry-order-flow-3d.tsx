"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  WorkspaceBatchDetail,
  WorkspaceOrder,
  WorkspaceProcedureStage,
} from "@/lib/analytics/workspace-snapshot";

import { equipmentTypeLabels, orderStatusLabels } from "./status-labels";
import styles from "./workspace.module.css";

type FlowState = "completed" | "active" | "pending";
type FlowStepKind = "milestone" | "stage" | "waiting";
type FlowDirection = "forward" | "backward";
type FlowVisual = "sending-staff" | "laundry-worker" | "laundry-cart" | "disinfection-tank" | "washer" | "dryer";
type FlowEquipmentType = WorkspaceProcedureStage["equipmentType"];
type FlowPhase = {
  id: "handoff" | "care" | "return";
  index: number;
  label: string;
  eyebrow: string;
  detail: string;
  state: FlowState;
  startIndex: number;
  endIndex: number;
  targetIndex: number;
};
type FlowStage = Omit<
  Pick<
    WorkspaceProcedureStage,
    "stageOrder" | "name" | "equipmentType" | "standardMinutes" | "startedAt" | "completedAt"
  >,
  "standardMinutes"
> & { standardMinutes: number | null };

type FlowTiming = {
  startedAt: string | null;
  completedAt: string | null;
  standardMinutes: number | null;
};

type FlowStep = {
  id: string;
  label: string;
  detail: string;
  state: FlowState;
  kind: FlowStepKind;
  visual: FlowVisual;
  equipmentType?: FlowEquipmentType;
  timing: FlowTiming;
};

type LaundryOrderFlow3DProps = {
  orderStatus: WorkspaceOrder["status"];
  batches: WorkspaceBatchDetail[];
  orderCreatedAt?: string | null;
  orderReceivedAt?: string | null;
  orderReadyAt?: string | null;
  orderClosedAt?: string | null;
  headerAction?: ReactNode;
  animateAllNodes?: boolean;
};

const fallbackStages: FlowStage[] = [
  { stageOrder: 1, name: "清洗", equipmentType: "washer", standardMinutes: null, startedAt: null, completedAt: null },
  { stageOrder: 2, name: "烘乾", equipmentType: "dryer", standardMinutes: null, startedAt: null, completedAt: null },
];

const stateLabels: Record<FlowState, string> = {
  completed: "已完成",
  active: "即時狀態",
  pending: "尚未完成",
};

const flowVisualSources: Record<FlowVisual, string> = {
  "sending-staff": "/images/laundry-flow/sending-staff-clean.webp",
  "laundry-worker": "/images/laundry-flow/laundry-worker.webp",
  "laundry-cart": "/images/laundry-flow/laundry-cart-clean.webp",
  "disinfection-tank": "/images/laundry-flow/disinfection-tank-clean.webp",
  washer: "/images/laundry-flow/washer-clean.webp",
  dryer: "/images/laundry-flow/dryer-clean.webp",
};

function equipmentLabel(type: FlowEquipmentType) {
  if (type in equipmentTypeLabels) {
    return equipmentTypeLabels[type as keyof typeof equipmentTypeLabels];
  }
  return type === "manual" ? "人工確認" : "洗衣車";
}

function timestampValue(value: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).valueOf();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function earliestTimestamp(values: Array<string | null>) {
  return values
    .filter((value): value is string => timestampValue(value) !== null)
    .sort((left, right) => (timestampValue(left) ?? 0) - (timestampValue(right) ?? 0))[0] ?? null;
}

function latestTimestamp(values: Array<string | null>) {
  return values
    .filter((value): value is string => timestampValue(value) !== null)
    .sort((left, right) => (timestampValue(right) ?? 0) - (timestampValue(left) ?? 0))[0] ?? null;
}

function getProcedureStages(batches: WorkspaceBatchDetail[]) {
  const stageGroups = new Map<string, WorkspaceProcedureStage[]>();
  for (const batch of batches) {
    for (const stage of batch.stages) {
      const key = `${stage.stageOrder}:${stage.name}`;
      stageGroups.set(key, [...(stageGroups.get(key) ?? []), stage]);
    }
  }

  if (stageGroups.size === 0) return fallbackStages;
  return [...stageGroups.values()]
    .map((group) => ({
      stageOrder: group[0]?.stageOrder ?? 0,
      name: group[0]?.name ?? "程序階段",
      equipmentType: group[0]?.equipmentType ?? "manual",
      standardMinutes: group[0]?.standardMinutes ?? null,
      startedAt: earliestTimestamp(group.map((stage) => stage.startedAt)),
      completedAt: latestTimestamp(group.map((stage) => stage.completedAt)),
    }))
    .sort((left, right) => left.stageOrder - right.stageOrder);
}

function matchingStages(batches: WorkspaceBatchDetail[], stage: FlowStage) {
  return batches.flatMap((batch) => batch.stages.filter((candidate) => (
    candidate.stageOrder === stage.stageOrder && candidate.name === stage.name
  )));
}

function getStageState(
  orderStatus: WorkspaceOrder["status"],
  batches: WorkspaceBatchDetail[],
  stage: FlowStage,
  fallbackIndex: number,
): FlowState {
  if (orderStatus === "ready_for_pickup" || orderStatus === "picked_up") return "completed";

  const matching = matchingStages(batches, stage);
  if (matching.some((candidate) => candidate.state === "active")) return "active";
  if (matching.length > 0 && matching.every((candidate) => candidate.state === "completed")) return "completed";

  if (orderStatus === "in_process" && matching.length === 0 && fallbackIndex === 0) return "active";
  return "pending";
}

function getWaitingStageState(
  orderStatus: WorkspaceOrder["status"],
  batches: WorkspaceBatchDetail[],
  stages: FlowStage[],
  stageIndex: number,
): FlowState {
  const stage = stages[stageIndex];
  const stageState = getStageState(orderStatus, batches, stage, stageIndex);
  if (stageState === "completed" || stageState === "active") return "completed";
  if (orderStatus !== "in_process") return "pending";

  const previousStagesCompleted = stages
    .slice(0, stageIndex)
    .every((previousStage, previousIndex) => (
      getStageState(orderStatus, batches, previousStage, previousIndex) === "completed"
    ));
  return previousStagesCompleted ? "active" : "pending";
}

function stageLabel(stage: FlowStage) {
  if (stage.equipmentType === "disinfection_tank") return "消毒浸泡";
  if (stage.equipmentType === "washer") return "清洗中";
  if (stage.equipmentType === "dryer") return "烘乾中";
  return stage.name;
}

function stageDetail(stage: FlowStage) {
  const label = stageLabel(stage);
  return label === stage.name ? equipmentLabel(stage.equipmentType) : `${stage.name} · ${equipmentLabel(stage.equipmentType)}`;
}

function stageVisual(stage: FlowStage): FlowVisual {
  if (stage.equipmentType === "disinfection_tank") return "disinfection-tank";
  if (stage.equipmentType === "washer") return "washer";
  if (stage.equipmentType === "dryer") return "dryer";
  if (stage.equipmentType === "cart") return "laundry-cart";
  return "laundry-worker";
}

function flowTiming(
  startedAt: string | null = null,
  completedAt: string | null = null,
  standardMinutes: number | null = null,
): FlowTiming {
  return { startedAt, completedAt, standardMinutes };
}

function getFlowSteps(
  orderStatus: WorkspaceOrder["status"],
  batches: WorkspaceBatchDetail[],
  orderTimes: Pick<LaundryOrderFlow3DProps, "orderCreatedAt" | "orderReceivedAt" | "orderReadyAt" | "orderClosedAt">,
): FlowStep[] {
  const procedureStages = getProcedureStages(batches);
  const firstStageStartedAt = earliestTimestamp(procedureStages.map((stage) => stage.startedAt));
  const lastStageCompletedAt = latestTimestamp(procedureStages.map((stage) => stage.completedAt));
  const orderReceivedAt = orderTimes.orderReceivedAt ?? null;
  const orderReadyAt = orderTimes.orderReadyAt ?? lastStageCompletedAt;
  const steps: FlowStep[] = [
    {
      id: "submitted",
      label: "送單",
      detail: "洗衣單已建立",
      state: "completed",
      kind: "milestone",
      visual: "sending-staff",
      timing: flowTiming(orderTimes.orderCreatedAt ?? null, orderTimes.orderCreatedAt ?? null),
    },
    {
      id: "awaiting-receipt",
      label: "待收件",
      detail: "等待洗衣員掃洗衣車固定 QR",
      state: orderStatus === "awaiting_receipt" ? "active" : "completed",
      kind: "milestone",
      visual: "laundry-worker",
      timing: flowTiming(orderTimes.orderCreatedAt ?? null, orderReceivedAt),
    },
    {
      id: "awaiting-cleaning",
      label: "待清洗",
      detail: "收單分類完成，等待第一個設備控制點",
      state: orderStatus === "awaiting_receipt"
        ? "pending"
        : orderStatus === "awaiting_cleaning"
          ? "active"
          : "completed",
      kind: "milestone",
      visual: "laundry-cart",
      timing: flowTiming(orderReceivedAt, firstStageStartedAt),
    },
  ];

  procedureStages.forEach((stage, index) => {
    if (stage.equipmentType === "dryer" && index > 0) {
      steps.push({
        id: `waiting-before-${stage.stageOrder}-${stage.name}`,
        label: "待烘衣",
        detail: "清洗完成後掃烘衣機開始下一階段",
        state: getWaitingStageState(orderStatus, batches, procedureStages, index),
        kind: "waiting",
        visual: "laundry-cart",
        equipmentType: stage.equipmentType,
        timing: flowTiming(
          procedureStages[index - 1]?.completedAt ?? orderReceivedAt,
          stage.startedAt,
        ),
      });
    }

    steps.push({
      id: `stage-${stage.stageOrder}-${stage.name}`,
      label: stageLabel(stage),
      detail: stageDetail(stage),
      state: getStageState(orderStatus, batches, stage, index),
      kind: "stage",
      visual: stageVisual(stage),
      equipmentType: stage.equipmentType,
      timing: flowTiming(stage.startedAt, stage.completedAt, stage.standardMinutes),
    });
  });

  steps.push(
    {
      id: "ready",
      label: "待取件",
      detail: "等待送洗人員掃車領回",
      state: orderStatus === "ready_for_pickup"
        ? "active"
        : orderStatus === "picked_up"
          ? "completed"
          : "pending",
      kind: "milestone",
      visual: "sending-staff",
      timing: flowTiming(orderReadyAt, orderTimes.orderClosedAt ?? null),
    },
    {
      id: "picked-up",
      label: "已取件",
      detail: "洗衣單結案",
      state: orderStatus === "picked_up" ? "completed" : "pending",
      kind: "milestone",
      visual: "sending-staff",
      timing: flowTiming(orderTimes.orderClosedAt ?? null, orderTimes.orderClosedAt ?? null),
    },
  );

  return steps;
}

function getFlowSummary(steps: FlowStep[], orderStatus: WorkspaceOrder["status"]) {
  const activeStep = steps.find((step) => step.state === "active");
  const completedCount = steps.filter((step) => step.state === "completed").length;
  const currentStep = activeStep ?? steps.find((step) => step.state === "pending") ?? steps.at(-1);
  return {
    label: currentStep?.label ?? orderStatusLabels[orderStatus],
    detail: activeStep ? `${activeStep.detail} · ${stateLabels.active}` : orderStatusLabels[orderStatus],
    completedCount,
    currentStep,
  };
}

function getFlowPhases(steps: FlowStep[]): FlowPhase[] {
  const phaseDefinitions = [
    { id: "handoff" as const, label: "照護交接", eyebrow: "01 · HANDOFF", detail: "送單、收件與分類", startIndex: 0, endIndex: Math.min(2, steps.length - 1) },
    { id: "care" as const, label: "專業洗滌", eyebrow: "02 · LAUNDRY", detail: "消毒、清洗與烘乾", startIndex: Math.min(3, steps.length - 1), endIndex: Math.max(0, steps.length - 3) },
    { id: "return" as const, label: "安心送回", eyebrow: "03 · RETURN", detail: "待取件與完成領回", startIndex: Math.max(0, steps.length - 2), endIndex: Math.max(0, steps.length - 1) },
  ];

  return phaseDefinitions.map((phase, index) => {
    const startIndex = Math.min(phase.startIndex, phase.endIndex);
    const endIndex = Math.max(phase.startIndex, phase.endIndex);
    const phaseSteps = steps.slice(startIndex, endIndex + 1);
    const activeOffset = phaseSteps.findIndex((step) => step.state === "active");
    const pendingOffset = phaseSteps.findIndex((step) => step.state === "pending");
    const state: FlowState = phaseSteps.length > 0 && phaseSteps.every((step) => step.state === "completed")
      ? "completed"
      : activeOffset >= 0
        ? "active"
        : "pending";
    const targetOffset = activeOffset >= 0
      ? activeOffset
      : pendingOffset >= 0
        ? pendingOffset
        : Math.max(0, phaseSteps.length - 1);

    return {
      ...phase,
      index,
      state,
      startIndex,
      endIndex,
      targetIndex: startIndex + targetOffset,
    };
  });
}

const flowDateTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Taipei",
});

function formatFlowDateTime(value: string | null) {
  if (!value || timestampValue(value) === null) return null;
  return flowDateTimeFormatter.format(new Date(value));
}

function formatMinutes(minutes: number) {
  if (minutes === 0) return "0 分鐘";
  if (minutes < 1) return "不到 1 分鐘";
  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const remainder = roundedMinutes % 60;
  if (hours === 0) return `${remainder} 分鐘`;
  if (remainder === 0) return `${hours} 小時`;
  return `${hours} 小時 ${remainder} 分鐘`;
}

function elapsedMinutes(timing: FlowTiming, state: FlowState, now: number | null) {
  const start = timestampValue(timing.startedAt);
  if (start === null) return null;
  const end = timestampValue(timing.completedAt) ?? (state === "active" ? now : null);
  if (end === null) return null;
  return Math.max(0, (end - start) / 60000);
}

function formatFlowTimingRange(timing: FlowTiming, state: FlowState) {
  const start = formatFlowDateTime(timing.startedAt);
  const end = formatFlowDateTime(timing.completedAt);
  if (start && end && start === end) return `紀錄 ${start}`;
  if (start && end) return `${start} → ${end}`;
  if (start) return `${start} → ${state === "active" ? "進行中" : "完成時間待補"}`;
  if (end) return `完成 ${end} · 開始時間待補`;
  return "尚無實際時間紀錄";
}

function formatFlowDuration(timing: FlowTiming, state: FlowState, now: number | null) {
  const elapsed = elapsedMinutes(timing, state, now);
  const actual = elapsed === null
    ? state === "active" ? "進行中 · 計時中" : "實際耗時待補"
    : timing.completedAt
      ? `實際耗時 ${formatMinutes(elapsed)}`
      : now === null ? "進行中 · 計時中" : `進行中 · 已 ${formatMinutes(elapsed)}`;
  return timing.standardMinutes
    ? `${actual} · 標準 ${formatMinutes(timing.standardMinutes)}`
    : actual;
}

function FlowTimingDetails({ timing, state, now }: { timing: FlowTiming; state: FlowState; now: number | null }) {
  return (
    <span className={styles.flowTiming}>
      <span>{formatFlowTimingRange(timing, state)}</span>
      <strong>{formatFlowDuration(timing, state, now)}</strong>
    </span>
  );
}

function readThemeColor(element: HTMLElement, variable: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(variable).trim();
  return value || fallback;
}

function safeColor(THREE: ThreeModule, value: string, fallback: number) {
  try {
    const normalized = /^#[0-9a-f]{8}$/i.test(value)
      ? value.slice(0, 7)
      : /^#[0-9a-f]{4}$/i.test(value)
        ? value.slice(0, 4)
        : value;
    return new THREE.Color(normalized);
  } catch {
    return new THREE.Color(fallback);
  }
}

type ThreeModule = typeof import("three");

type FlowIconPainter = {
  visual: FlowVisual;
  image: CanvasImageSource;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  detail: HTMLCanvasElement;
  detailContext: CanvasRenderingContext2D;
  stamp: HTMLCanvasElement;
  stampContext: CanvasRenderingContext2D;
  texture: InstanceType<ThreeModule["CanvasTexture"]>;
};

type FlowPart = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  pivotX: number;
  pivotY: number;
  phase?: number;
};

const flowIconRigs: Record<FlowVisual, {
  head?: FlowPart;
  arms?: FlowPart[];
  legs?: FlowPart[];
  drum?: { cx: number; cy: number; rx: number; ry: number };
  wheels?: Array<{ cx: number; cy: number; r: number }>;
  pot?: { cx: number; cy: number; rx: number; ry: number };
}> = {
  "sending-staff": {
    head: { cx: 0.3, cy: 0.16, rx: 0.14, ry: 0.15, pivotX: 0.3, pivotY: 0.28 },
    arms: [{ cx: 0.42, cy: 0.4, rx: 0.15, ry: 0.13, pivotX: 0.33, pivotY: 0.35, phase: 0 }],
    legs: [
      { cx: 0.23, cy: 0.78, rx: 0.1, ry: 0.2, pivotX: 0.25, pivotY: 0.6, phase: 0 },
      { cx: 0.35, cy: 0.8, rx: 0.1, ry: 0.18, pivotX: 0.33, pivotY: 0.6, phase: Math.PI },
    ],
    wheels: [
      { cx: 0.55, cy: 0.88, r: 0.09 },
      { cx: 0.82, cy: 0.88, r: 0.09 },
    ],
  },
  "laundry-worker": {
    head: { cx: 0.5, cy: 0.13, rx: 0.16, ry: 0.15, pivotX: 0.5, pivotY: 0.26 },
    arms: [
      { cx: 0.28, cy: 0.4, rx: 0.16, ry: 0.14, pivotX: 0.38, pivotY: 0.34, phase: 0 },
      { cx: 0.72, cy: 0.4, rx: 0.16, ry: 0.14, pivotX: 0.62, pivotY: 0.34, phase: Math.PI },
    ],
    legs: [
      { cx: 0.42, cy: 0.78, rx: 0.1, ry: 0.2, pivotX: 0.44, pivotY: 0.58, phase: 0 },
      { cx: 0.58, cy: 0.78, rx: 0.1, ry: 0.2, pivotX: 0.56, pivotY: 0.58, phase: Math.PI },
    ],
  },
  "laundry-cart": {
    wheels: [
      { cx: 0.3, cy: 0.86, r: 0.11 },
      { cx: 0.7, cy: 0.86, r: 0.11 },
    ],
  },
  "disinfection-tank": {
    pot: { cx: 0.5, cy: 0.54, rx: 0.3, ry: 0.22 },
  },
  washer: {
    drum: { cx: 0.5, cy: 0.45, rx: 0.24, ry: 0.24 },
  },
  dryer: {
    drum: { cx: 0.5, cy: 0.4, rx: 0.26, ry: 0.25 },
  },
};

function createOffscreenCanvas(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  return context ? { canvas, context } : null;
}

function createFlowIconPainter(THREE: ThreeModule, source: InstanceType<ThreeModule["Texture"]>, visual: FlowVisual): FlowIconPainter | null {
  const image = source.image as CanvasImageSource | undefined;
  if (!image) return null;
  const canvas = createOffscreenCanvas(192);
  const detail = createOffscreenCanvas(192);
  const stamp = createOffscreenCanvas(192);
  if (!canvas || !detail || !stamp) return null;
  const texture = new THREE.CanvasTexture(canvas.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  detail.context.drawImage(image, 0, 0, 192, 192);
  compositeComicOutline(canvas.context, detail.canvas, stamp.canvas, stamp.context, "#d8d0cc", 8);
  texture.needsUpdate = true;
  return {
    visual,
    image,
    canvas: canvas.canvas,
    context: canvas.context,
    detail: detail.canvas,
    detailContext: detail.context,
    stamp: stamp.canvas,
    stampContext: stamp.context,
    texture,
  };
}

function fillSilhouette(stamp: CanvasRenderingContext2D, source: HTMLCanvasElement, color: string) {
  stamp.clearRect(0, 0, source.width, source.height);
  stamp.globalCompositeOperation = "source-over";
  stamp.drawImage(source, 0, 0);
  stamp.globalCompositeOperation = "source-in";
  stamp.fillStyle = color;
  stamp.fillRect(0, 0, source.width, source.height);
  stamp.globalCompositeOperation = "source-over";
}

function compositeComicOutline(
  output: CanvasRenderingContext2D,
  detail: HTMLCanvasElement,
  stampCanvas: HTMLCanvasElement,
  stamp: CanvasRenderingContext2D,
  glowColor: string,
  glowStrength: number,
) {
  const size = detail.width;
  output.clearRect(0, 0, size, size);
  fillSilhouette(stamp, detail, glowColor);
  output.save();
  output.shadowColor = glowColor;
  output.shadowBlur = glowStrength;
  output.drawImage(stampCanvas, 0, 0);
  output.restore();
  fillSilhouette(stamp, detail, "#111111");
  const outline = 5;
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    output.drawImage(stampCanvas, Math.cos(angle) * outline, Math.sin(angle) * outline);
  }
  fillSilhouette(stamp, detail, "#ffffff");
  output.drawImage(stampCanvas, 0, 0);
  output.drawImage(detail, 0, 0);
}

function paintFlowPart(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  size: number,
  part: FlowPart,
  rotation: number,
) {
  const cx = part.cx * size;
  const cy = part.cy * size;
  const rx = part.rx * size;
  const ry = part.ry * size;
  const pivotX = part.pivotX * size;
  const pivotY = part.pivotY * size;
  context.save();
  context.beginPath();
  context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  context.clip();
  context.clearRect(cx - rx - 2, cy - ry - 2, rx * 2 + 4, ry * 2 + 4);
  context.translate(pivotX, pivotY);
  context.rotate(rotation);
  context.translate(-pivotX, -pivotY);
  context.drawImage(image, 0, 0, size, size);
  context.restore();
}

function clothInDrum(phase: number, rx: number, ry: number) {
  const liftEnd = Math.PI * 0.82;
  const cycle = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (cycle < liftEnd) {
    const theta = Math.PI / 2 - cycle;
    return { x: Math.cos(theta) * rx * 0.76, y: Math.sin(theta) * ry * 0.76 };
  }
  const fall = (cycle - liftEnd) / (Math.PI * 2 - liftEnd);
  const startTheta = Math.PI / 2 - liftEnd;
  const x0 = Math.cos(startTheta) * rx * 0.76;
  const y0 = Math.sin(startTheta) * ry * 0.76;
  const vx = Math.sin(startTheta) * rx * 1.35;
  const vy = -Math.cos(startTheta) * ry * 0.25;
  let x = x0 + vx * fall;
  let y = y0 + vy * fall + 1.8 * ry * fall * fall;
  const nx = x / rx;
  const ny = y / ry;
  const depth = Math.hypot(nx, ny);
  if (depth > 0.8) {
    x *= 0.8 / depth;
    y *= 0.8 / depth;
  }
  return { x, y };
}

function paintFlowIcon(
  painter: FlowIconPainter,
  active: boolean,
  playing: boolean,
  elapsed: number,
  glowColor: string,
) {
  const { detailContext, image, visual, detail } = painter;
  const size = detail.width;
  detailContext.clearRect(0, 0, size, size);
  detailContext.drawImage(image, 0, 0, size, size);
  if (playing) {
    const intensity = active ? 1 : 0.35;
    const gait = elapsed * (active ? 5.1 : 2.2);
    const rig = flowIconRigs[visual];
    if (rig.head) {
      const gaze = -Math.sin(gait) * 0.07 * intensity;
      const bob = Math.sin(gait * 2) * 0.04 * intensity;
      paintFlowPart(detailContext, image, size, rig.head, gaze + bob);
    }
    rig.arms?.forEach((arm) => {
      const locked = visual === "sending-staff";
      const swing = Math.sin(gait + (arm.phase ?? 0) + Math.PI) * (locked ? 0.05 : 0.16) * intensity;
      paintFlowPart(detailContext, image, size, arm, swing);
    });
    rig.legs?.forEach((leg) => {
      paintFlowPart(detailContext, image, size, leg, Math.sin(gait + (leg.phase ?? 0)) * 0.15 * intensity);
    });
    if (rig.drum) {
      const cx = rig.drum.cx * size;
      const cy = rig.drum.cy * size;
      const rx = rig.drum.rx * size * 0.7;
      const ry = rig.drum.ry * size * 0.7;
      const omega = visual === "dryer" ? 2.8 : 2.1;
      detailContext.save();
      detailContext.beginPath();
      detailContext.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      detailContext.clip();
      detailContext.translate(cx, cy);
      const clothFill = visual === "dryer" ? "rgba(255, 214, 170, 0.5)" : "rgba(186, 228, 232, 0.48)";
      detailContext.fillStyle = clothFill;
      for (let index = 0; index < 3; index += 1) {
        const pos = clothInDrum(elapsed * omega + index * (Math.PI * 2 / 3), rx, ry);
        detailContext.beginPath();
        detailContext.ellipse(pos.x, pos.y, rx * 0.16, ry * 0.11, pos.x * 0.02, 0, Math.PI * 2);
        detailContext.fill();
      }
      detailContext.restore();
    }
    rig.wheels?.forEach((wheel) => {
      const cx = wheel.cx * size;
      const cy = wheel.cy * size;
      const radius = wheel.r * size * 0.55;
      const travel = visual === "laundry-cart"
        ? Math.sin(elapsed * 1.35) * (active ? 9 : 3)
        : Math.sin(gait) * (active ? 7 : 2.5);
      const angle = -travel / Math.max(radius, 1);
      detailContext.save();
      detailContext.beginPath();
      detailContext.arc(cx, cy, radius, 0, Math.PI * 2);
      detailContext.clip();
      detailContext.translate(cx, cy);
      detailContext.rotate(angle);
      detailContext.strokeStyle = `rgba(36, 62, 66, ${active ? 0.38 : 0.16})`;
      detailContext.lineWidth = 2;
      detailContext.beginPath();
      detailContext.moveTo(-radius * 0.68, 0);
      detailContext.lineTo(radius * 0.68, 0);
      detailContext.moveTo(0, -radius * 0.68);
      detailContext.lineTo(0, radius * 0.68);
      detailContext.stroke();
      detailContext.restore();
    });
    if (rig.pot) {
      const cx = rig.pot.cx * size;
      const cy = rig.pot.cy * size;
      const rx = rig.pot.rx * size;
      const ry = rig.pot.ry * size;
      detailContext.save();
      detailContext.beginPath();
      detailContext.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      detailContext.clip();
      for (let index = 0; index < 7; index += 1) {
        const radius = 2.4 + index % 3;
        const rise = (8 + index * 2.2) * (active ? 1 : 0.45);
        const life = (elapsed * rise / (ry * 2) + index * 0.17) % 1;
        const bubbleX = cx + Math.sin(life * 5.2 + index * 1.8) * rx * 0.18;
        const bubbleY = cy + ry * 0.62 - life * ry * 1.2;
        const grown = radius * (1 + life * 0.55);
        detailContext.globalAlpha = (life > 0.82 ? (1 - life) / 0.18 : 1) * 0.32;
        detailContext.fillStyle = "rgb(255,255,255)";
        detailContext.beginPath();
        detailContext.arc(bubbleX, bubbleY, grown, 0, Math.PI * 2);
        detailContext.fill();
      }
      detailContext.globalAlpha = 1;
      detailContext.restore();
    }
  }
  const glowStrength = active
    ? 18 + (playing ? (Math.sin(elapsed * 3.1) + 1) * 6 : 0)
    : 8;
  compositeComicOutline(
    painter.context,
    detail,
    painter.stamp,
    painter.stampContext,
    glowColor,
    glowStrength,
  );
}

function flowSpriteMotion(visual: FlowVisual, active: boolean, playing: boolean, elapsed: number) {
  if (!playing) return { x: 0, y: 0, rot: 0 };
  const amp = active ? 0.22 : 0.08;
  if (visual === "sending-staff" || visual === "laundry-worker") {
    const gait = elapsed * (active ? 5.1 : 2.2);
    return {
      x: 0,
      y: -Math.cos(gait * 2) * 0.012 * amp,
      rot: Math.sin(gait) * 0.012 * amp,
    };
  }
  if (visual === "laundry-cart") {
    const travel = Math.sin(elapsed * 1.35) * 0.01 * amp;
    return { x: travel, y: 0, rot: 0 };
  }
  if (visual === "washer" || visual === "dryer") {
    const spin = elapsed * (visual === "dryer" ? 2.8 : 2.1);
    return {
      x: Math.sin(spin) * 0.003 * amp,
      y: Math.cos(spin * 2) * 0.002 * amp,
      rot: 0,
    };
  }
  return { x: 0, y: 0, rot: 0 };
}

function placeFlowTooltip(
  element: HTMLElement,
  nodeX: number,
  nodeY: number,
  containerWidth: number,
  containerHeight: number,
  avoid: Array<{ x: number; y: number }>,
) {
  const cardWidth = Math.max(element.offsetWidth, 168);
  const cardHeight = Math.max(element.offsetHeight, 88);
  const pad = 12;
  const gap = 82;
  const iconRadius = 70;
  const sameRow = avoid.filter((icon) => Math.abs(icon.y - nodeY) < 52);
  const candidates = [
    { x: nodeX - cardWidth / 2, y: nodeY - gap - cardHeight, rowSide: false },
    { x: nodeX - cardWidth / 2, y: nodeY + gap, rowSide: false },
    { x: nodeX + gap, y: nodeY - cardHeight / 2, rowSide: true },
    { x: nodeX - gap - cardWidth, y: nodeY - cardHeight / 2, rowSide: true },
  ];
  const overlapsIcon = (x: number, y: number, iconX: number, iconY: number) => {
    const closestX = Math.min(Math.max(iconX, x), x + cardWidth);
    const closestY = Math.min(Math.max(iconY, y), y + cardHeight);
    return Math.hypot(iconX - closestX, iconY - closestY) < iconRadius;
  };
  const score = (x: number, y: number, rowSide: boolean) => {
    const clampedX = Math.min(Math.max(pad, x), Math.max(pad, containerWidth - pad - cardWidth));
    const clampedY = Math.min(Math.max(pad, y), Math.max(pad, containerHeight - pad - cardHeight));
    let value = Math.hypot(clampedX - x, clampedY - y);
    if (rowSide && sameRow.length > 0) value += 220;
    for (const icon of sameRow) {
      if (overlapsIcon(clampedX, clampedY, icon.x, icon.y)) value += 160;
    }
    return { x: clampedX, y: clampedY, value };
  };
  let best = score(candidates[0].x, candidates[0].y, candidates[0].rowSide);
  for (let index = 1; index < candidates.length; index += 1) {
    const next = score(candidates[index].x, candidates[index].y, candidates[index].rowSide);
    if (next.value < best.value) best = next;
  }
  element.style.left = `${Math.round(best.x)}px`;
  element.style.top = `${Math.round(best.y)}px`;
}

export function LaundryOrderFlow3D({
  orderStatus,
  batches,
  orderCreatedAt = null,
  orderReceivedAt = null,
  orderReadyAt = null,
  orderClosedAt = null,
  headerAction,
  animateAllNodes = false,
}: LaundryOrderFlow3DProps) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [reducedMotion, setReducedMotion] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [clock, setClock] = useState<number | null>(null);
  const isPlayingRef = useRef(true);
  const steps = useMemo(() => getFlowSteps(orderStatus, batches, {
    orderCreatedAt,
    orderReceivedAt,
    orderReadyAt,
    orderClosedAt,
  }), [batches, orderClosedAt, orderCreatedAt, orderReadyAt, orderReceivedAt, orderStatus]);
  const stepsRef = useRef(steps);
  const sceneSignature = steps
    .map((step) => `${step.id}:${step.state}:${step.visual}`)
    .join("|");
  const summary = useMemo(() => getFlowSummary(steps, orderStatus), [orderStatus, steps]);
  const phases = useMemo(() => getFlowPhases(steps), [steps]);
  const completionPercent = Math.round(summary.completedCount / steps.length * 100);
  const defaultStepId = steps.find((step) => step.state === "active")?.id
    ?? steps.find((step) => step.state === "pending")?.id
    ?? steps.at(-1)?.id
    ?? null;
  const [selectedStepId, setSelectedStepId] = useState<string | null>(defaultStepId);
  const [highlightedStepId, setHighlightedStepId] = useState<string | null>(null);
  const storedSelectedStepIndex = steps.findIndex((step) => step.id === selectedStepId);
  const selectedStepIndex = storedSelectedStepIndex >= 0
    ? storedSelectedStepIndex
    : Math.max(0, steps.findIndex((step) => step.id === defaultStepId));
  const selectedStep = steps[selectedStepIndex] ?? steps[0];
  const inspectStep = steps.find((step) => step.id === highlightedStepId) ?? selectedStep;
  const selectedStepIndexRef = useRef(selectedStepIndex);
  const highlightByIndexRef = useRef<(index: number | null) => void>(() => {});
  const [selectionDirection, setSelectionDirection] = useState<FlowDirection>("forward");

  const selectStep = useCallback((index: number) => {
    const step = steps[index];
    if (!step) return;
    setSelectionDirection(index < selectedStepIndexRef.current ? "backward" : "forward");
    selectedStepIndexRef.current = index;
    isPlayingRef.current = false;
    setSelectedStepId(step.id);
    setIsPlaying(false);
  }, [steps]);
  const selectStepRef = useRef(selectStep);

  useEffect(() => {
    stepsRef.current = steps;
    selectStepRef.current = selectStep;
    highlightByIndexRef.current = (index) => {
      const id = index === null ? null : stepsRef.current[index]?.id ?? null;
      setHighlightedStepId((current) => current === id ? current : id);
    };
  }, [selectStep, steps]);

  const toggleAnimation = () => {
    setIsPlaying((playing) => {
      const nextPlaying = !playing;
      isPlayingRef.current = nextPlaying;
      return nextPlaying;
    });
  };

  useEffect(() => {
    selectedStepIndexRef.current = selectedStepIndex;
  }, [selectedStepIndex]);

  useEffect(() => {
    const updateClock = () => setClock(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host || reducedMotion) return;

    let disposed = false;
    let animationFrame = 0;
    let cleanupScene: (() => void) | undefined;
    setRenderFailed(false);

    async function mountScene() {
      try {
        const THREE = await import("three");
        if (disposed || !canvasHostRef.current) return;

        const container = canvasHostRef.current;
        const sceneSteps = stepsRef.current;
        const width = Math.max(container.clientWidth, 320);
        const height = Math.max(container.clientHeight, 190);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 100);

        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        renderer.setSize(width, height, false);
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        renderer.domElement.style.touchAction = "none";
        container.replaceChildren(renderer.domElement);

        const completedColor = safeColor(
          THREE,
          readThemeColor(container, "--flow-completed", "#397967"),
          0x397967,
        );
        const brandColor = safeColor(
          THREE,
          readThemeColor(container, "--flow-brand", "#dd3742"),
          0xdd3742,
        );
        const warmSand = safeColor(
          THREE,
          readThemeColor(container, "--flow-sand", "#ddb18c"),
          0xddb18c,
        );
        const textureLoader = new THREE.TextureLoader();
        const uniqueVisuals = [...new Set(sceneSteps.map((step) => step.visual))];
        const visualTextures = new Map<FlowVisual, InstanceType<ThreeModule["Texture"]>>();
        await Promise.all(uniqueVisuals.map(async (visual) => {
          const texture = await textureLoader.loadAsync(flowVisualSources[visual]);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          visualTextures.set(visual, texture);
        }));
        if (disposed) {
          visualTextures.forEach((texture) => texture.dispose());
          renderer.dispose();
          return;
        }

        const checkCanvas = document.createElement("canvas");
        checkCanvas.width = 96;
        checkCanvas.height = 96;
        const checkContext = checkCanvas.getContext("2d");
        if (checkContext) {
          checkContext.fillStyle = "#397967";
          checkContext.beginPath();
          checkContext.arc(48, 48, 42, 0, Math.PI * 2);
          checkContext.fill();
          checkContext.strokeStyle = "#ffffff";
          checkContext.lineCap = "round";
          checkContext.lineJoin = "round";
          checkContext.lineWidth = 11;
          checkContext.beginPath();
          checkContext.moveTo(27, 49);
          checkContext.lineTo(42, 64);
          checkContext.lineTo(70, 32);
          checkContext.stroke();
        }
        const checkTexture = new THREE.CanvasTexture(checkCanvas);
        checkTexture.colorSpace = THREE.SRGBColorSpace;
        const pinCanvas = document.createElement("canvas");
        pinCanvas.width = 96;
        pinCanvas.height = 96;
        const pinContext = pinCanvas.getContext("2d");
        if (pinContext) {
          pinContext.translate(48, 40);
          pinContext.fillStyle = "#dd3742";
          pinContext.beginPath();
          pinContext.moveTo(0, 30);
          pinContext.bezierCurveTo(-22, 8, -20, -18, 0, -18);
          pinContext.bezierCurveTo(20, -18, 22, 8, 0, 30);
          pinContext.fill();
          pinContext.fillStyle = "#ffffff";
          pinContext.beginPath();
          pinContext.arc(0, -6, 8, 0, Math.PI * 2);
          pinContext.fill();
        }
        const pinTexture = new THREE.CanvasTexture(pinCanvas);
        pinTexture.colorSpace = THREE.SRGBColorSpace;
        const activeStepIndexForScene = sceneSteps.findIndex((step) => step.state === "active");
        const fallbackMarkerIndex = Math.max(0, sceneSteps.reduce(
          (last, step, index) => step.state === "completed" ? index : last,
          0,
        ));
        const actualProgressIndex = activeStepIndexForScene >= 0
          ? activeStepIndexForScene
          : fallbackMarkerIndex;
        const columns = Math.min(width < 480 ? 2 : 3, sceneSteps.length);
        const rows = Math.ceil(sceneSteps.length / columns);
        const topMargin = 0.13;
        const bottomMargin = 0.16;
        const sideMargin = 0.05;
        const framingDistance = 7.6;
        const worldHeight = 2 * framingDistance * Math.tan(camera.fov * Math.PI / 180 / 2);
        const worldWidth = worldHeight * (width / Math.max(height, 1));
        const cellHeight = worldHeight * (1 - topMargin - bottomMargin) / Math.max(rows, 1);
        const cellWidth = worldWidth * (1 - sideMargin * 2) / Math.max(columns, 1);
        const nodeSize = Math.min(cellWidth, cellHeight) / 1.22;
        const outlineSize = nodeSize * 1.14;
        const horizontalSpacing = cellWidth;
        const verticalSpacing = cellHeight;
        const spriteLift = nodeSize * 0.38;
        const startY = ((rows - 1) * verticalSpacing) / 2;
        const positions = sceneSteps.map((_, index) => {
          const row = Math.floor(index / columns);
          const column = index % columns;
          const pathColumn = row % 2 === 0 ? column : columns - 1 - column;
          return new THREE.Vector3(
            (pathColumn - (columns - 1) / 2) * horizontalSpacing,
            startY - row * verticalSpacing,
            0,
          );
        });
        const fitCamera = (viewWidth: number, viewHeight: number) => {
          camera.aspect = viewWidth / viewHeight;
          const tan = Math.tan(camera.fov * Math.PI / 180 / 2);
          const visualWidth = Math.max(outlineSize, (columns - 1) * horizontalSpacing + outlineSize);
          const visualHeight = Math.max(outlineSize, (rows - 1) * verticalSpacing + outlineSize);
          const distance = Math.max(
            visualHeight / 2 / ((1 - topMargin - bottomMargin) * tan),
            visualWidth / 2 / ((1 - sideMargin * 2) * tan * camera.aspect),
            4.4,
          );
          camera.position.set(0, spriteLift, distance);
          camera.lookAt(0, spriteLift, 0);
          camera.updateProjectionMatrix();
        };
        fitCamera(width, height);
        const root = new THREE.Group();
        scene.add(root);

        root.add(new THREE.HemisphereLight(0xfffaf8, 0xb78067, 2.65));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
        keyLight.position.set(0, 5, 5);
        root.add(keyLight);

        const ambiencePositions = new Float32Array(14 * 3);
        for (let index = 0; index < 14; index += 1) {
          ambiencePositions[index * 3] = ((index * 47) % 97) / 97 * 8 - 4;
          ambiencePositions[index * 3 + 1] = ((index * 31) % 89) / 89 * 5 - 2.5;
          ambiencePositions[index * 3 + 2] = -0.8 + ((index * 17) % 23) / 23;
        }
        const ambienceGeometry = new THREE.BufferGeometry();
        ambienceGeometry.setAttribute("position", new THREE.BufferAttribute(ambiencePositions, 3));
        const ambience = new THREE.Points(
          ambienceGeometry,
          new THREE.PointsMaterial({
            color: warmSand,
            size: 0.035,
            transparent: true,
            opacity: 0.34,
            depthWrite: false,
          }),
        );
        root.add(ambience);

        const linkY = nodeSize * 0.38;
        const linkInset = nodeSize * 0.56;
        const addCyberpunkLink = (
          from: InstanceType<ThreeModule["Vector3"]>,
          to: InstanceType<ThreeModule["Vector3"]>,
          kind: "done" | "now" | "wait",
        ) => {
          const start = from.clone();
          const end = to.clone();
          start.y += linkY;
          end.y += linkY;
          const direction = end.clone().sub(start);
          const distance = direction.length();
          if (distance < 0.28) return;
          direction.multiplyScalar(1 / distance);
          const inset = Math.min(linkInset, distance * 0.36);
          start.addScaledVector(direction, inset);
          end.addScaledVector(direction, -inset);
          const curve = new THREE.LineCurve3(start, end);
          const glowColor = kind === "done" ? 0x2ef0ff : kind === "now" ? 0xff3dad : 0x6a3cff;
          const coreColor = kind === "wait" ? 0xb8a8ff : 0xf4ffff;
          root.add(new THREE.Mesh(
            new THREE.TubeGeometry(curve, 10, 0.048, 8, false),
            new THREE.MeshBasicMaterial({
              color: glowColor,
              transparent: true,
              opacity: kind === "wait" ? 0.16 : 0.34,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          ));
          root.add(new THREE.Mesh(
            new THREE.TubeGeometry(curve, 10, 0.016, 8, false),
            new THREE.MeshBasicMaterial({
              color: coreColor,
              transparent: true,
              opacity: kind === "wait" ? 0.42 : 0.95,
              depthWrite: false,
            }),
          ));
        };
        for (let index = 0; index < positions.length - 1; index += 1) {
          const from = positions[index];
          const to = positions[index + 1];
          if (!from || !to) continue;
          const kind = index + 1 <= actualProgressIndex
            ? "done"
            : index === actualProgressIndex
              ? "now"
              : "wait";
          addCyberpunkLink(from, to, kind);
        }

        const nodeGroups: Array<InstanceType<ThreeModule["Group"]>> = [];
        const nodeSprites: Array<InstanceType<ThreeModule["Sprite"]>> = [];
        const iconPainters: Array<FlowIconPainter | null> = [];
        const interactiveObjects: Array<InstanceType<ThreeModule["Object3D"]>> = [];
        const activeEffects: Array<{
          group: InstanceType<ThreeModule["Group"]>;
          visual: FlowVisual;
        }> = [];

        sceneSteps.forEach((step, index) => {
          const position = positions[index];
          const group = new THREE.Group();
          group.position.copy(position);
          group.userData.flowStepIndex = index;
          group.scale.setScalar(index === selectedStepIndexRef.current ? 1.06 : 1);
          nodeGroups.push(group);

          const isCompleted = step.state === "completed";
          const isActive = step.state === "active";

          const sourceTexture = visualTextures.get(step.visual);
          const painter = sourceTexture ? createFlowIconPainter(THREE, sourceTexture, step.visual) : null;
          if (painter && isCompleted) {
            paintFlowIcon(painter, false, false, 0, `#${completedColor.getHexString()}`);
            painter.texture.needsUpdate = true;
          }
          iconPainters.push(painter);
          const visualMap = painter?.texture ?? sourceTexture;
          const nodeMaterial = new THREE.SpriteMaterial({
            map: visualMap,
            color: isCompleted || isActive ? 0xffffff : 0x8d8885,
            transparent: true,
            opacity: isCompleted || isActive ? 1 : 0.55,
            alphaTest: 0.02,
            depthWrite: false,
          });
          const node = new THREE.Sprite(nodeMaterial);
          node.scale.set(nodeSize, nodeSize, 1);
          node.position.y = nodeSize * 0.38;
          node.userData.flowStepIndex = index;
          group.add(node);
          nodeSprites.push(node);
          interactiveObjects.push(node);

          if (isCompleted) {
            const check = new THREE.Sprite(new THREE.SpriteMaterial({
              map: checkTexture,
              transparent: true,
              depthWrite: false,
            }));
            check.scale.set(0.3, 0.3, 1);
            check.position.set(0.4, 0.94, 0.05);
            group.add(check);
          }

          if (isActive) {
            const effectGroup = new THREE.Group();
            effectGroup.position.y = 0.48;
            const effectColor = step.visual === "dryer" ? warmSand : brandColor;
            for (let particleIndex = 0; particleIndex < 8; particleIndex += 1) {
              const particle = new THREE.Mesh(
                new THREE.SphereGeometry(0.025 + (particleIndex % 2) * 0.012, 8, 6),
                new THREE.MeshBasicMaterial({
                  color: effectColor,
                  transparent: true,
                  opacity: 0.72,
                  depthWrite: false,
                }),
              );
              particle.userData.particleIndex = particleIndex;
              effectGroup.add(particle);
            }
            group.add(effectGroup);
            activeEffects.push({ group: effectGroup, visual: step.visual });
          }

          root.add(group);
        });

        const marker = new THREE.Sprite(new THREE.SpriteMaterial({
          map: pinTexture,
          color: 0xffffff,
          transparent: true,
          opacity: 0.96,
          depthWrite: false,
        }));
        const badgeOffsetX = nodeSize * 0.62;
        const badgeOffsetY = nodeSize * 0.92;
        marker.scale.set(0.34, 0.34, 1);
        marker.position.x = (positions[0]?.x ?? 0) + badgeOffsetX;
        marker.position.y = (positions[0]?.y ?? 0) + badgeOffsetY;
        root.add(marker);

        const pulseGroup = new THREE.Group();
        const pulseGeometry = new THREE.SphereGeometry(0.055, 10, 8);
        for (let index = 0; index < 6; index += 1) {
          pulseGroup.add(new THREE.Mesh(
            pulseGeometry,
            new THREE.MeshBasicMaterial({ color: brandColor, transparent: true, opacity: 0.82 }),
          ));
        }
        const pulseFromIndex = Math.max(0, activeStepIndexForScene - 1);
        pulseGroup.visible = isPlayingRef.current && activeStepIndexForScene > 0;
        root.add(pulseGroup);

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        let hoveredNodeIndex: number | null = null;
        let targetRootRotationX = 0;
        let targetRootRotationY = 0;

        const hitNode = (event: PointerEvent) => {
          const bounds = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
          pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObjects(interactiveObjects, false)[0];
          let object: InstanceType<ThreeModule["Object3D"]> | null = hit?.object ?? null;
          while (object && typeof object.userData.flowStepIndex !== "number") object = object.parent;
          return object && typeof object.userData.flowStepIndex === "number"
            ? object.userData.flowStepIndex as number
            : null;
        };

        const applyHover = (nextIndex: number | null) => {
          hoveredNodeIndex = nextIndex;
          renderer.domElement.style.cursor = nextIndex === null ? "default" : "pointer";
          highlightByIndexRef.current(nextIndex);
        };

        const onPointerMove = (event: PointerEvent) => {
          const bounds = renderer.domElement.getBoundingClientRect();
          const offsetX = (event.clientX - bounds.left) / bounds.width - 0.5;
          const offsetY = (event.clientY - bounds.top) / bounds.height - 0.5;
          targetRootRotationX = offsetY * -0.035;
          targetRootRotationY = offsetX * 0.05;
          applyHover(hitNode(event));
        };
        const onPointerLeave = () => {
          targetRootRotationX = 0;
          targetRootRotationY = 0;
          applyHover(null);
        };
        const onClick = (event: PointerEvent) => {
          const index = hoveredNodeIndex ?? hitNode(event);
          if (index === null || !sceneSteps[index]) return;
          selectStepRef.current(index);
        };
        renderer.domElement.addEventListener("pointermove", onPointerMove);
        renderer.domElement.addEventListener("pointerleave", onPointerLeave);
        renderer.domElement.addEventListener("click", onClick);

        const tooltipWorld = new THREE.Vector3();
        const onResize = () => {
          const nextWidth = Math.max(container.clientWidth, 320);
          const nextHeight = Math.max(container.clientHeight, 190);
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
          renderer.setSize(nextWidth, nextHeight, false);
          fitCamera(nextWidth, nextHeight);
        };
        const observer = new ResizeObserver(onResize);
        observer.observe(container);

        let previousTime = performance.now();
        const animate = (time: number) => {
          if (disposed) return;
          const delta = Math.min((time - previousTime) / 1000, 0.05);
          previousTime = time;
          const elapsed = time / 1000;
          const playing = isPlayingRef.current;
          const selectedIndex = selectedStepIndexRef.current;
          const markerTargetIndex = playing ? actualProgressIndex : selectedIndex;
          const markerTarget = positions[markerTargetIndex] ?? positions[0];
          marker.position.x = THREE.MathUtils.damp(
            marker.position.x,
            (markerTarget?.x ?? 0) + badgeOffsetX,
            5,
            delta,
          );
          marker.position.y = THREE.MathUtils.damp(
            marker.position.y,
            (markerTarget?.y ?? 0) + badgeOffsetY + (playing ? Math.sin(elapsed * 2.2) * 0.02 : 0),
            5,
            delta,
          );
          const markerScale = playing ? 0.34 + Math.sin(elapsed * 2.2) * 0.014 : 0.34;
          marker.scale.set(markerScale, markerScale, 1);
          root.rotation.x = THREE.MathUtils.damp(root.rotation.x, targetRootRotationX, 4, delta);
          root.rotation.y = THREE.MathUtils.damp(
            root.rotation.y,
            targetRootRotationY + (playing ? Math.sin(elapsed * 0.28) * 0.012 : 0),
            4,
            delta,
          );
          nodeGroups.forEach((group, index) => {
            const current = sceneSteps[index]?.state === "active";
            const selectedScale = current ? 1.22 : index === selectedIndex ? 1.08 : 1;
            const pulse = current && playing ? 1 + Math.sin(elapsed * 4.4) * 0.035 : 1;
            const targetScale = (index === hoveredNodeIndex ? selectedScale + 0.05 : selectedScale) * pulse;
            const nextScale = THREE.MathUtils.damp(group.scale.x, targetScale, 8, delta);
            group.scale.setScalar(nextScale);
          });
          const selectedTarget = positions[selectedIndex] ?? positions[0];
          root.position.x = THREE.MathUtils.damp(root.position.x, -(selectedTarget?.x ?? 0) * 0.012, 4, delta);
          root.position.y = THREE.MathUtils.damp(root.position.y, -(selectedTarget?.y ?? 0) * 0.01, 4, delta);
          ambience.rotation.z = playing ? elapsed * 0.012 : ambience.rotation.z;
          ambience.position.y = playing ? Math.sin(elapsed * 0.24) * 0.04 : 0;
          iconPainters.forEach((painter, index) => {
            if (!painter) return;
            const step = sceneSteps[index];
            if (!animateAllNodes && step.state !== "active") return;
            const glowColor = step.state === "active"
              ? `#${brandColor.getHexString()}`
              : step.state === "completed"
                ? `#${completedColor.getHexString()}`
                : "#d8d0cc";
            paintFlowIcon(painter, true, playing, elapsed, glowColor);
            painter.texture.needsUpdate = true;
          });
          nodeSprites.forEach((sprite, index) => {
            const step = sceneSteps[index];
            const motion = flowSpriteMotion(
              step.visual,
              animateAllNodes || step.state === "active",
              playing,
              elapsed,
            );
            const spriteY = nodeSize * 0.38 + motion.y;
            sprite.position.x = motion.x;
            sprite.position.y = spriteY;
            sprite.material.rotation = motion.rot;
          });
          activeEffects.forEach(({ group, visual }) => {
            group.children.forEach((child, index) => {
              if (visual === "disinfection-tank") {
                child.position.x = (index - 4) * 0.055;
                child.position.y = -0.18 + ((elapsed * 0.38 + index * 0.08) % 0.72);
              } else if (visual === "sending-staff" || visual === "laundry-worker" || visual === "laundry-cart") {
                const bounce = (elapsed * 1.8 + index * 0.14) % 1;
                child.position.x = (index % 2 === 0 ? -0.12 : 0.12) + Math.sin(elapsed * 3 + index) * 0.04;
                child.position.y = -0.08 + bounce * 0.42;
              } else {
                const speed = visual === "dryer" ? 3.4 : 4.6;
                const angle = elapsed * speed + index * (Math.PI * 2 / group.children.length);
                const radiusX = visual === "dryer" ? 0.42 : 0.38;
                const radiusY = visual === "dryer" ? 0.34 : 0.28;
                child.position.x = Math.cos(angle) * radiusX;
                child.position.y = Math.sin(angle) * radiusY;
              }
            });
            group.visible = playing;
          });
          const hasPulsePath = playing && activeStepIndexForScene > 0;
          pulseGroup.visible = hasPulsePath;
          if (hasPulsePath) {
            const from = positions[pulseFromIndex];
            const to = positions[activeStepIndexForScene];
            pulseGroup.children.forEach((child, index) => {
              const progress = (elapsed * 0.42 + index / pulseGroup.children.length) % 1;
              child.position.lerpVectors(from, to, progress);
              child.position.y += 0.08 + Math.sin((elapsed + index) * 2) * 0.02;
            });
          }
          const tooltip = tooltipRef.current;
          const inspectIndex = hoveredNodeIndex ?? selectedIndex;
          const inspectGroup = nodeGroups[inspectIndex];
          if (tooltip && inspectGroup) {
            const viewWidth = renderer.domElement.clientWidth;
            const viewHeight = renderer.domElement.clientHeight;
            const projectNode = (index: number) => {
              const group = nodeGroups[index];
              if (!group) return null;
              group.getWorldPosition(tooltipWorld);
              tooltipWorld.y += nodeSize * 0.38;
              tooltipWorld.project(camera);
              return {
                x: (tooltipWorld.x * 0.5 + 0.5) * viewWidth,
                y: (-tooltipWorld.y * 0.5 + 0.5) * viewHeight,
              };
            };
            const currentPoint = projectNode(inspectIndex);
            if (currentPoint) {
              const avoid = nodeGroups
                .map((_, index) => index === inspectIndex ? null : projectNode(index))
                .filter((point): point is { x: number; y: number } => (
                  point !== null && Math.abs(point.y - currentPoint.y) < 56
                ));
              placeFlowTooltip(
                tooltip,
                currentPoint.x,
                currentPoint.y,
                viewWidth,
                viewHeight,
                avoid,
              );
            }
          }
          renderer.render(scene, camera);
          animationFrame = requestAnimationFrame(animate);
        };
        animationFrame = requestAnimationFrame(animate);

        cleanupScene = () => {
          cancelAnimationFrame(animationFrame);
          observer.disconnect();
          renderer.domElement.removeEventListener("pointermove", onPointerMove);
          renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
          renderer.domElement.removeEventListener("click", onClick);
          scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.geometry.dispose();
              const material = object.material;
              if (Array.isArray(material)) material.forEach((item) => item.dispose());
              else material.dispose();
            } else if (object instanceof THREE.Points) {
              object.geometry.dispose();
              const material = object.material;
              if (Array.isArray(material)) material.forEach((item) => item.dispose());
              else material.dispose();
            } else if (object instanceof THREE.Sprite) {
              object.material.dispose();
            }
          });
          pulseGeometry.dispose();
          checkTexture.dispose();
          pinTexture.dispose();
          iconPainters.forEach((painter) => painter?.texture.dispose());
          visualTextures.forEach((texture) => texture.dispose());
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch {
        if (!disposed) setRenderFailed(true);
      }
    }

    void mountScene();
    return () => {
      disposed = true;
      cleanupScene?.();
    };
  }, [animateAllNodes, reducedMotion, sceneSignature]);

  const previousStep = () => selectStep(Math.max(0, selectedStepIndex - 1));
  const nextStep = () => selectStep(Math.min(steps.length - 1, selectedStepIndex + 1));

  return (
    <section className={styles.orderFlow} aria-labelledby={titleId}>
      <header className={styles.orderFlowHeader}>
        <div>
          <p className={styles.eyebrow}>HOK CARE · LAUNDRY JOURNEY</p>
          <div className={styles.orderFlowTitleRow}>
            <h3 id={titleId}>洗衣單流程</h3>
            {headerAction}
          </div>
          <p>安心洗衣旅程：每一次交接、清洗與烘乾都看得見，讓送洗人員掌握衣物目前位置。</p>
        </div>
      </header>

      <div className={styles.orderFlowCurrent} aria-live="polite">
        <span>NOW · 目前實際位置</span>
        <strong>{summary.label}</strong>
        <small>{summary.detail}</small>
        {summary.currentStep ? (
          <FlowTimingDetails timing={summary.currentStep.timing} state={summary.currentStep.state} now={clock} />
        ) : null}
        <span className={styles.orderFlowProgress} aria-label={`已完成 ${summary.completedCount} / ${steps.length} 個節點`}>
          <i style={{ width: `${completionPercent}%` }} />
        </span>
        <b>{String(completionPercent).padStart(2, "0")}%</b>
      </div>

      <nav className={styles.flowPhaseRail} aria-label="洗衣旅程三大階段">
        {phases.map((phase) => (
          <button
            key={phase.id}
            type="button"
            data-state={phase.state}
            data-selected={selectedStepIndex >= phase.startIndex && selectedStepIndex <= phase.endIndex}
            onClick={() => selectStep(phase.targetIndex)}
            aria-label={`查看${phase.label}：${stateLabels[phase.state]}`}
          >
            <span>{phase.eyebrow}</span>
            <strong>{phase.label}</strong>
            <small>{phase.detail}</small>
            <i aria-hidden="true">{phase.state === "completed" ? "✓" : phase.index + 1}</i>
          </button>
        ))}
      </nav>

      <div className={styles.flowJourneyStage}>
        <div className={styles.flowCanvasStage} role="group" aria-label="LIVE PROCESS MAP">
          <div className={styles.flowCanvasScene}>
            <div className={styles.flowCanvasWrap} ref={canvasHostRef} aria-hidden="true" />
            <div className={styles.flowCanvasMeta} ref={tooltipRef} aria-live="polite">
              <span>LIVE PROCESS MAP</span>
              <strong>{inspectStep.label}</strong>
              <small>{inspectStep.detail} · {stateLabels[inspectStep.state]}</small>
              <FlowTimingDetails timing={inspectStep.timing} state={inspectStep.state} now={clock} />
            </div>
            <div className={styles.flowCanvasGuide} aria-hidden="true">
              <span>交接</span>
              <span>洗滌</span>
              <span>送回</span>
            </div>
            {reducedMotion || renderFailed ? (
              <ol className={styles.flowMapNodes} aria-label="洗衣單流程狀態">
                {steps.map((step, index) => {
                  const isSelected = selectedStepIndex === index;
                  return (
                    <li key={step.id} data-state={step.state} data-selected={isSelected}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`查看流程節點：${step.label}，${stateLabels[step.state]}`}
                        onClick={() => selectStep(index)}
                        onMouseEnter={() => setHighlightedStepId(step.id)}
                        onMouseLeave={() => setHighlightedStepId(null)}
                        onFocus={() => setHighlightedStepId(step.id)}
                        onBlur={() => setHighlightedStepId(null)}
                      >
                        <strong>{step.label}</strong>
                        <em>{stateLabels[step.state]}</em>
                        <FlowTimingDetails timing={step.timing} state={step.state} now={clock} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>
        </div>
        <div className={styles.flowInteractivePanel}>
          <div className={styles.flowSelection} aria-label="已選流程節點" aria-live="polite">
            <div
              key={selectedStep.id}
              className={styles.flowSelectionMotion}
              data-direction={selectionDirection}
              data-state={selectedStep.state}
            >
              <span className={styles.flowSelectionVisual} aria-hidden="true">
                <Image
                  className={styles.flowSelectionImage}
                  src={flowVisualSources[selectedStep.visual]}
                  alt=""
                  width={160}
                  height={160}
                  loading="eager"
                />
                <i>{selectedStep.state === "completed" ? "✓" : selectedStepIndex + 1}</i>
              </span>
              <span className={styles.flowSelectionCopy}>
                <span>STEP {String(selectedStepIndex + 1).padStart(2, "0")} · {stateLabels[selectedStep.state]}</span>
                <strong>{selectedStep.label}</strong>
                <small>{selectedStep.detail}</small>
                <FlowTimingDetails timing={selectedStep.timing} state={selectedStep.state} now={clock} />
              </span>
            </div>
          </div>
          <div className={styles.flowSelectionIndex} aria-hidden="true">
            <span>{String(selectedStepIndex + 1).padStart(2, "0")}</span>
            <i />
            <small>{String(steps.length).padStart(2, "0")}</small>
          </div>
          <div className={styles.flowControls} role="group" aria-label="流程動畫控制">
            <button
              className={styles.flowControlButton}
              type="button"
              onClick={previousStep}
              disabled={selectedStepIndex === 0}
              aria-label="查看上一個流程節點"
            >
              ← 上一節
            </button>
            <button
              className={styles.flowControlButton}
              type="button"
              onClick={nextStep}
              disabled={selectedStepIndex === steps.length - 1}
              aria-label="查看下一個流程節點"
            >
              下一節 →
            </button>
            <button
              className={`${styles.flowControlButton} ${styles.flowPlayButton}`}
              type="button"
              aria-pressed={isPlaying}
              onClick={toggleAnimation}
            >
              {isPlaying ? "暫停動畫" : "播放動畫"}
            </button>
          </div>
        </div>
      </div>
      <p className={styles.flowCanvasNotice}>
        {reducedMotion
          ? "已依裝置設定停用動畫；請用地圖上的文字節點查看實際時間與耗時。"
          : renderFailed
            ? "此裝置無法顯示 3D 動畫；請用地圖上的文字節點查看實際時間與耗時。"
            : "滑過節點可查看實際時間與耗時；點選可聚焦。動畫不會改變洗衣單實際狀態。"}
      </p>
      <p className={styles.flowAccessibleSummary}>
        已完成 {summary.completedCount} 個流程節點；目前為「{summary.label}」，訂單狀態為「{orderStatusLabels[orderStatus]}」。
      </p>
      <div className={styles.flowLegend} aria-label="流程狀態圖例">
        <span data-state="completed"><i aria-hidden="true" />已完成</span>
        <span data-state="active"><i aria-hidden="true" />即時狀態</span>
        <span data-state="pending"><i aria-hidden="true" />尚未完成</span>
      </div>
    </section>
  );
}
