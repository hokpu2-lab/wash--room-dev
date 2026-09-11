import { expect, test } from "vitest";

import {
  parseLaundryOrderHistory,
  parseLaundryOrderHistoryDetail,
} from "../../src/lib/analytics/order-history-model";

const siteId = "20000000-0000-4000-8000-000000000099";
const orderId = "30000000-0000-4000-8000-000000000101";

test("已取件歷史結果解析成頁面使用的 DTO", () => {
  const result = parseLaundryOrderHistory({
    outcome: "ok",
    site_id: siteId,
    period: { start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
    queue: {
      total: 1,
      limit: 20,
      offset: 0,
      items: [{
        id: orderId,
        order_number: "MAIN-20260818-0001",
        status: "picked_up",
        created_at: "2026-08-18T05:00:00.000Z",
        closed_at: "2026-08-18T08:00:00.000Z",
        institution_code: "CARE-A",
        institution_name: "照護機構 A",
        cart_number: "CART-A-01",
        site_code: "MAIN",
        site_name: "本館",
      }],
    },
  }, { query: "0001", page: 1, pageSize: 20 });

  expect(result).toMatchObject({ siteId, total: 1, query: "0001" });
  expect(result?.items[0]).toMatchObject({
    id: orderId,
    orderNumber: "MAIN-20260818-0001",
    institutionName: "照護機構 A",
    cartNumber: "CART-A-01",
    closedAt: "2026-08-18T08:00:00.000Z",
  });
});

test("非已取件或缺少必要欄位的 RPC 結果不會進入頁面", () => {
  expect(parseLaundryOrderHistory({
    outcome: "ok",
    site_id: siteId,
    period: { start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
    queue: { total: 1, limit: 20, offset: 0, items: [{ id: orderId, order_number: "MAIN-20260818-0001", status: "in_process" }] },
  }, { page: 1, pageSize: 20 })).toBeNull();
});

test("已取件詳情解析成訂單、稽核事件與批次程序 DTO", () => {
  const result = parseLaundryOrderHistoryDetail({
    outcome: "ok",
    order: {
      id: orderId,
      order_number: "MAIN-20260818-0001",
      status: "picked_up",
      created_at: "2026-08-18T05:00:00.000Z",
      closed_at: "2026-08-18T08:00:00.000Z",
      institution_code: "CARE-A",
      institution_name: "照護機構 A",
      cart_number: "CART-A-01",
      site_code: "MAIN",
      site_name: "本館",
    },
    batches: [{
      id: "40000000-0000-4000-8000-000000000101",
      batch_sequence: 1,
      category_code: "SOILED",
      category_name: "汙衣",
      procedure_name: "加強洗烘",
      procedure_version: 2,
      status: "loaded",
      current_stage_order: 2,
      active_equipment_name: null,
      active_equipment_type: null,
      progress: {
        stage_run_id: null,
        stage_status: "completed",
        stage_progress_percent: 100,
        overall_progress_percent: 100,
        estimated_stage_completed_at: null,
        overdue_minutes: 0,
        total_standard_minutes: 90,
        is_estimate: true,
      },
      stages: [{
        stage_order: 1,
        name: "清洗",
        standard_minutes: 45,
        equipment_type: "washer",
        state: "completed",
        started_at: "2026-08-18T05:30:00.000Z",
        completed_at: "2026-08-18T06:15:00.000Z",
      }],
    }],
    events: [{
      id: "50000000-0000-4000-8000-000000000101",
      occurred_at: "2026-08-18T08:00:00.000Z",
      action: "laundry_order_picked_up",
      outcome: "succeeded",
      reason: "送洗人員掃車取件",
      batch_id: null,
      equipment_name: null,
    }],
  });

  expect(result).toMatchObject({
    order: { orderNumber: "MAIN-20260818-0001", status: "picked_up" },
    batches: [{ categoryName: "汙衣", status: "loaded", stages: [{ name: "清洗" }] }],
    events: [{ action: "laundry_order_picked_up", reason: "送洗人員掃車取件" }],
  });
});

test("非 ok 的歷史詳情 RPC 結果不會進入彈窗", () => {
  expect(parseLaundryOrderHistoryDetail({ outcome: "not_found" })).toBeNull();
});
