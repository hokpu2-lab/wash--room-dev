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
        received_at: "2026-08-18T05:15:00.000Z",
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
    createdAt: "2026-08-18T05:00:00.000Z",
    receivedAt: "2026-08-18T05:15:00.000Z",
    closedAt: "2026-08-18T08:00:00.000Z",
  });
});

test("進行中訂單歷史結果解析成頁面使用的 DTO（含 stageName 待烘衣/待洗衣/待清洗/待取件/取件完成）", () => {
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
        order_number: "MAIN-20260818-0002",
        status: "in_process",
        stage_name: "待烘衣",
        created_at: "2026-08-18T05:00:00.000Z",
        closed_at: null,
        institution_code: "CARE-A",
        institution_name: "照護機構 A",
        cart_number: "CART-A-01",
        site_code: "MAIN",
        site_name: "本館",
      }],
    },
  }, { query: "0002", page: 1, pageSize: 20 });

  expect(result).toMatchObject({ siteId, total: 1, query: "0002" });
  expect(result?.items[0]).toMatchObject({
    id: orderId,
    orderNumber: "MAIN-20260818-0002",
    status: "in_process",
    stageName: "待烘衣",
    closedAt: null,
  });
});

test("缺少必要欄位的 RPC 結果不會進入頁面", () => {
  expect(parseLaundryOrderHistory({
    outcome: "ok",
    site_id: siteId,
    period: { start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
    queue: { total: 1, limit: 20, offset: 0, items: [{ id: orderId, order_number: "MAIN-20260818-0001" }] },
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

test("完成時間計算與格式化", async () => {
  const { formatCompletionTime } = await import("../../src/app/app/history-results");
  expect(formatCompletionTime("", null)).toBe("—");
  expect(formatCompletionTime("2026-09-23T06:09:00.000Z", "2026-09-24T06:24:00.000Z")).toBe("24 小時 15 分鐘");
  expect(formatCompletionTime("2026-09-16T08:36:00.000Z", "2026-09-16T08:41:00.000Z")).toBe("5 分鐘");
  expect(formatCompletionTime("2026-09-16T08:00:00.000Z", "2026-09-16T10:00:00.000Z")).toBe("2 小時");
  expect(formatCompletionTime("2026-09-16T08:00:00.000Z", "2026-09-16T08:00:20.000Z")).toBe("0 分鐘");
});

test("歷史日期時間格式化為 YYYY/MM/DD 上午/下午HH:mm", async () => {
  const { formatDateTime } = await import("../../src/app/app/history-results");
  expect(formatDateTime("")).toBe("—");
  expect(formatDateTime("invalid-date")).toBe("—");
  expect(formatDateTime("2026-09-30T16:00:00.000Z")).toBe("2026/10/01 上午12:00");
  expect(formatDateTime("2026-09-24T06:21:00.000Z")).toBe("2026/09/24 下午02:21");
});

test("歷史查詢結果排序功能（洗衣單號、送洗機構、取件時間）", async () => {
  const { sortHistoryItems } = await import("../../src/app/app/history-results");

  const sampleItems = [
    {
      id: "1",
      orderNumber: "MAIN-20261005-0004",
      status: "awaiting_cleaning",
      createdAt: "2026-10-05T05:43:00.000Z",
      closedAt: null,
      institutionCode: "SPRING",
      institutionName: "清春",
      cartNumber: "8D-1",
      siteCode: "MAIN",
      siteName: "本館",
    },
    {
      id: "2",
      orderNumber: "MAIN-20261005-0002",
      status: "picked_up",
      createdAt: "2026-10-05T03:44:00.000Z",
      closedAt: "2026-10-05T05:42:00.000Z",
      institutionCode: "HOK",
      institutionName: "清福",
      cartNumber: "8C-1",
      siteCode: "MAIN",
      siteName: "本館",
    },
    {
      id: "3",
      orderNumber: "MAIN-20260923-0002",
      status: "picked_up",
      createdAt: "2026-09-23T06:10:00.000Z",
      closedAt: "2026-10-02T06:48:00.000Z",
      institutionCode: "MOUNTAIN",
      institutionName: "清山",
      cartNumber: "8E-1",
      siteCode: "MAIN",
      siteName: "本館",
    },
  ];

  // 1. 洗衣單號升序與降序
  const byOrderAsc = sortHistoryItems(sampleItems, "order_number", "asc");
  expect(byOrderAsc.map((i) => i.orderNumber)).toEqual([
    "MAIN-20260923-0002",
    "MAIN-20261005-0002",
    "MAIN-20261005-0004",
  ]);
  const byOrderDesc = sortHistoryItems(sampleItems, "order_number", "desc");
  expect(byOrderDesc.map((i) => i.orderNumber)).toEqual([
    "MAIN-20261005-0004",
    "MAIN-20261005-0002",
    "MAIN-20260923-0002",
  ]);

  // 2. 送洗機構升序與降序
  const byInstAsc = sortHistoryItems(sampleItems, "institution", "asc");
  expect(byInstAsc.map((i) => i.institutionName)).toEqual(["清山", "清春", "清福"]);
  const byInstDesc = sortHistoryItems(sampleItems, "institution", "desc");
  expect(byInstDesc.map((i) => i.institutionName)).toEqual(["清福", "清春", "清山"]);

  // 3. 取件時間升序與降序 (nulls 排在最後)
  const byPickupAsc = sortHistoryItems(sampleItems, "pickup_time", "asc");
  expect(byPickupAsc.map((i) => i.id)).toEqual(["3", "2", "1"]);
  const byPickupDesc = sortHistoryItems(sampleItems, "pickup_time", "desc");
  expect(byPickupDesc.map((i) => i.id)).toEqual(["2", "3", "1"]);

  // 4. 無排序 key 回傳原陣列
  expect(sortHistoryItems(sampleItems, null, "asc")).toEqual(sampleItems);
});

test("歷史狀態標籤解析與「清洗中」轉為「處理中」", async () => {
  const { renderOrderStatusLabel } = await import("../../src/app/app/history-results");
  expect(renderOrderStatusLabel("in_process", "清洗中")).toBe("處理中");
  expect(renderOrderStatusLabel("in_process", "烘乾中")).toBe("烘乾中");
  expect(renderOrderStatusLabel("in_process", null)).toBe("處理中");
  expect(renderOrderStatusLabel("picked_up", null)).toBe("取件完成");
  expect(renderOrderStatusLabel("awaiting_receipt", null)).toBe("待收件");
});

test("歷史查詢紀錄與詳情彈窗正確取得收件時間（送單時間與取件時間中間）", async () => {
  const { formatDateTime } = await import("../../src/app/app/history-results");

  // 1. 待收件訂單：尚未收件，receivedAt 為 null，格式化為 —
  const pendingHistory = parseLaundryOrderHistory({
    outcome: "ok",
    site_id: siteId,
    period: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-15T00:00:00.000Z" },
    queue: {
      total: 1,
      limit: 20,
      offset: 0,
      items: [{
        id: orderId,
        order_number: "MAIN-20261012-0001",
        status: "awaiting_receipt",
        created_at: "2026-10-12T01:30:00.000Z",
        received_at: null,
        closed_at: null,
        institution_code: "CARE-A",
        institution_name: "照護機構 A",
        cart_number: "CART-A-01",
        site_code: "MAIN",
        site_name: "本館",
      }],
    },
  }, { page: 1, pageSize: 20 });

  expect(pendingHistory?.items[0].receivedAt).toBeNull();
  expect(formatDateTime(pendingHistory?.items[0].receivedAt)).toBe("—");

  // 2. 已收件訂單：包含 received_at，格式化為正確台北時間
  const receivedHistory = parseLaundryOrderHistory({
    outcome: "ok",
    site_id: siteId,
    period: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-15T00:00:00.000Z" },
    queue: {
      total: 1,
      limit: 20,
      offset: 0,
      items: [{
        id: orderId,
        order_number: "MAIN-20261012-0002",
        status: "in_process",
        created_at: "2026-10-12T01:30:00.000Z",
        received_at: "2026-10-12T01:45:00.000Z",
        closed_at: null,
        institution_code: "CARE-A",
        institution_name: "照護機構 A",
        cart_number: "CART-A-01",
        site_code: "MAIN",
        site_name: "本館",
      }],
    },
  }, { page: 1, pageSize: 20 });

  expect(receivedHistory?.items[0].receivedAt).toBe("2026-10-12T01:45:00.000Z");
  expect(formatDateTime(receivedHistory?.items[0].receivedAt)).toBe("2026/10/12 上午09:45");

  // 3. 詳情彈窗：若 RPC 訂單未直接提供 received_at，自動從 laundry_order_received 事件回退推導
  const detailResult = parseLaundryOrderHistoryDetail({
    outcome: "ok",
    order: {
      id: orderId,
      order_number: "MAIN-20261012-0002",
      status: "in_process",
      created_at: "2026-10-12T01:30:00.000Z",
      received_at: null,
      closed_at: null,
      institution_code: "CARE-A",
      institution_name: "照護機構 A",
      cart_number: "CART-A-01",
      site_code: "MAIN",
      site_name: "本館",
    },
    batches: [],
    events: [{
      id: "50000000-0000-4000-8000-000000000102",
      occurred_at: "2026-10-12T01:45:00.000Z",
      action: "laundry_order_received",
      outcome: "succeeded",
      reason: "收單分類",
      batch_id: null,
      equipment_name: null,
    }],
  });

  expect(detailResult?.order.receivedAt).toBe("2026-10-12T01:45:00.000Z");
  expect(formatDateTime(detailResult?.order.receivedAt)).toBe("2026/10/12 上午09:45");
});

test("歷史查詢紀錄與詳情彈窗正確取得完成時間（收件時間與取件時間中間）與總花費時間", async () => {
  const { formatDateTime, formatCompletionTime } = await import("../../src/app/app/history-results");

  // 1. 未完成洗烘訂單：readyAt 為 null，格式化為 —
  const inProcessHistory = parseLaundryOrderHistory({
    outcome: "ok",
    site_id: siteId,
    period: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-15T00:00:00.000Z" },
    queue: {
      total: 1,
      limit: 20,
      offset: 0,
      items: [{
        id: orderId,
        order_number: "MAIN-20261012-0003",
        status: "in_process",
        created_at: "2026-10-12T01:30:00.000Z",
        received_at: "2026-10-12T01:45:00.000Z",
        ready_at: null,
        closed_at: null,
        institution_code: "CARE-A",
        institution_name: "照護機構 A",
        cart_number: "CART-A-01",
        site_code: "MAIN",
        site_name: "本館",
      }],
    },
  }, { page: 1, pageSize: 20 });

  expect(inProcessHistory?.items[0].readyAt).toBeNull();
  expect(formatDateTime(inProcessHistory?.items[0].readyAt)).toBe("—");
  expect(formatCompletionTime(inProcessHistory!.items[0].createdAt, inProcessHistory!.items[0].closedAt)).toBe("—");

  // 2. 待取件/已取件訂單：包含 ready_at，格式化為正確台北時間，以及計算總花費時間
  const completedHistory = parseLaundryOrderHistory({
    outcome: "ok",
    site_id: siteId,
    period: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-15T00:00:00.000Z" },
    queue: {
      total: 1,
      limit: 20,
      offset: 0,
      items: [{
        id: orderId,
        order_number: "MAIN-20261012-0004",
        status: "picked_up",
        created_at: "2026-10-12T01:30:00.000Z",
        received_at: "2026-10-12T01:45:00.000Z",
        ready_at: "2026-10-12T03:15:00.000Z",
        closed_at: "2026-10-12T04:30:00.000Z",
        institution_code: "CARE-A",
        institution_name: "照護機構 A",
        cart_number: "CART-A-01",
        site_code: "MAIN",
        site_name: "本館",
      }],
    },
  }, { page: 1, pageSize: 20 });

  expect(completedHistory?.items[0].readyAt).toBe("2026-10-12T03:15:00.000Z");
  expect(formatDateTime(completedHistory?.items[0].readyAt)).toBe("2026/10/12 上午11:15");
  expect(formatDateTime(completedHistory?.items[0].closedAt)).toBe("2026/10/12 下午12:30");
  expect(formatCompletionTime(completedHistory!.items[0].createdAt, completedHistory!.items[0].closedAt)).toBe("3 小時");

  // 3. 詳情彈窗：若 RPC 訂單未直接提供 ready_at，自動從 laundry_batch_loaded_to_source_cart 事件回退推導
  const detailResult = parseLaundryOrderHistoryDetail({
    outcome: "ok",
    order: {
      id: orderId,
      order_number: "MAIN-20261012-0004",
      status: "picked_up",
      created_at: "2026-10-12T01:30:00.000Z",
      received_at: "2026-10-12T01:45:00.000Z",
      ready_at: null,
      closed_at: "2026-10-12T04:30:00.000Z",
      institution_code: "CARE-A",
      institution_name: "照護機構 A",
      cart_number: "CART-A-01",
      site_code: "MAIN",
      site_name: "本館",
    },
    batches: [],
    events: [{
      id: "50000000-0000-4000-8000-000000000103",
      occurred_at: "2026-10-12T03:15:00.000Z",
      action: "laundry_batch_loaded_to_source_cart",
      outcome: "succeeded",
      reason: "裝回來源車",
      batch_id: null,
      equipment_name: null,
    }],
  });

  expect(detailResult?.order.readyAt).toBe("2026-10-12T03:15:00.000Z");
  expect(formatDateTime(detailResult?.order.readyAt)).toBe("2026/10/12 上午11:15");
});

