import { expect, test } from "vitest";

import {
  mergeWorkspaceSnapshots,
  parseWorkspaceSnapshot,
} from "../../src/lib/analytics/workspace-snapshot";

const siteId = "20000000-0000-4000-8000-000000000099";
const orderId = "30000000-0000-4000-8000-000000000101";
const batchId = "40000000-0000-4000-8000-000000000201";
const stageRunId = "50000000-0000-4000-8000-000000000301";

function snapshotPayload(orderIds = [orderId]) {
  return {
    outcome: "ok",
    site_id: siteId,
    period: { start: "2026-08-27T00:00:00.000Z", end: "2026-08-28T00:00:00.000Z" },
    orders: { awaiting_receipt: 0, in_process: 1, ready_for_pickup: 0, picked_up: 0 },
    batches: { not_started: 0, in_progress: 1, paused: 0, completed: 0 },
    queue: {
      total: orderIds.length,
      limit: 20,
      offset: 0,
      items: orderIds.map((id, index) => ({
        id,
        order_number: `MAIN-20260827-${String(index + 1).padStart(4, "0")}`,
        status: "in_process",
        updated_at: "2026-08-27T08:00:00.000Z",
        institution_name: "晴禾護理之家",
        cart_number: "CART-MAIN-01",
      })),
    },
    open_batches: [{
      id: batchId,
      status: "in_progress",
      stage_order: 2,
      order_number: "MAIN-20260827-0001",
      category_name: "汙衣",
    }],
    order_details: [{
      order_id: orderIds[0] ?? orderId,
      order_created_at: "2026-08-27T06:45:00.000Z",
      order_received_at: "2026-08-27T07:00:00.000Z",
      order_ready_at: null,
      order_closed_at: null,
      batches: [{
        id: batchId,
        batch_sequence: 1,
        category_code: "SOILED",
        category_name: "汙衣",
        procedure_name: "加強洗烘",
        procedure_version: 2,
        status: "in_progress",
        current_stage_order: 2,
        active_equipment_name: "WASH-02",
        active_equipment_type: "washer",
        progress: {
          stage_run_id: stageRunId,
          stage_status: "in_progress",
          stage_progress_percent: 72,
          overall_progress_percent: 48,
          estimated_stage_completed_at: "2026-08-27T08:30:00.000Z",
          overdue_minutes: 0,
          total_standard_minutes: 90,
          is_estimate: true,
        },
        stages: [
          {
            stage_order: 1,
            name: "待清洗完成",
            standard_minutes: 30,
            equipment_type: "manual",
            state: "completed",
            started_at: "2026-08-27T07:00:00.000Z",
            completed_at: "2026-08-27T07:30:00.000Z",
          },
          {
            stage_order: 2,
            name: "清洗中實際狀態",
            standard_minutes: 60,
            equipment_type: "washer",
            state: "active",
            started_at: "2026-08-27T07:30:00.000Z",
            completed_at: null,
          },
          {
            stage_order: 3,
            name: "待烘衣",
            standard_minutes: 30,
            equipment_type: "dryer",
            state: "pending",
            started_at: null,
            completed_at: null,
          },
        ],
      }],
    }],
    equipment: [],
    incidents: [],
    generated_at: "2026-08-27T08:00:00.000Z",
  };
}

test("工作台快照解析洗衣單批次、程序階段與預估進度", () => {
  const snapshot = parseWorkspaceSnapshot(snapshotPayload());

  expect(snapshot?.orderDetails[0]?.batches[0]).toMatchObject({
    batchSequence: 1,
    categoryName: "汙衣",
    procedureName: "加強洗烘",
    procedureVersion: 2,
    activeEquipmentName: "WASH-02",
    progress: {
      overallProgressPercent: 48,
      stageProgressPercent: 72,
      isEstimate: true,
    },
  });
  expect(snapshot?.orderDetails[0]?.batches[0]?.stages.map((stage) => stage.state)).toEqual([
    "completed",
    "active",
    "pending",
  ]);
  expect(snapshot?.orderDetails[0]).toMatchObject({
    orderCreatedAt: "2026-08-27T06:45:00.000Z",
    orderReceivedAt: "2026-08-27T07:00:00.000Z",
    orderReadyAt: null,
    orderClosedAt: null,
  });
});

test("舊版快照沒有詳情欄位時仍可解析", () => {
  const payload = snapshotPayload();
  delete (payload as { order_details?: unknown }).order_details;

  expect(parseWorkspaceSnapshot(payload)?.orderDetails).toEqual([]);
});

test("合併即時快照時只保留目前頁面的洗衣單詳情", () => {
  const first = parseWorkspaceSnapshot(snapshotPayload())!;
  const secondOrderId = "30000000-0000-4000-8000-000000000102";
  const second = parseWorkspaceSnapshot(snapshotPayload([secondOrderId]))!;

  const merged = mergeWorkspaceSnapshots([first, second], { page: 2, pageSize: 1 });

  expect(merged?.orders.map((order) => order.id)).toEqual([secondOrderId]);
  expect(merged?.orderDetails.map((detail) => detail.orderId)).toEqual([secondOrderId]);
});
