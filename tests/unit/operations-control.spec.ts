import { describe, expect, it } from "vitest";

import { formatBatchLabel, type ControlBatch } from "../../src/app/app/operations/batch-label";

describe("操作控制點與批次標籤 (Operations Control & Batch Labels)", () => {
  it("formatBatchLabel 正確格式化包含作業據點名稱的批次", () => {
    const batch: ControlBatch = {
      id: "b1111111-1111-4111-8111-111111111111",
      status: "not_started",
      current_stage_order: 1,
      orderNumber: "MAIN-20260911-0001",
      cartNumber: "8D-1",
      categoryName: "床簾",
      institutionName: "清春",
      operating_site_id: "site-main",
      operating_site_name: "清福本館",
    };

    const label = formatBatchLabel(batch);
    expect(label).toBe("MAIN-20260911-0001 · 8D-1 · 床簾 · 清春 · (清福本館) · 第 1 階段");
  });

  it("formatBatchLabel 在未提供據點名稱時維持簡潔格式", () => {
    const batch: ControlBatch = {
      id: "b2222222-2222-4222-8222-222222222222",
      status: "not_started",
      current_stage_order: 2,
      orderNumber: "CORP-20260911-0002",
      cartNumber: "7C-2",
      categoryName: "毛巾",
      institutionName: "清福醫院",
    };

    const label = formatBatchLabel(batch);
    expect(label).toBe("CORP-20260911-0002 · 7C-2 · 毛巾 · 清福醫院 · 第 2 階段");
  });

  it("設備據點過濾機制可正確篩選出同據點批次", () => {
    const batches: ControlBatch[] = [
      {
        id: "batch-main-1",
        status: "not_started",
        current_stage_order: 1,
        orderNumber: "MAIN-001",
        operating_site_id: "site-main",
        operating_site_name: "清福本館",
      },
      {
        id: "batch-corp-1",
        status: "not_started",
        current_stage_order: 1,
        orderNumber: "CORP-001",
        operating_site_id: "site-corp",
        operating_site_name: "清福法人",
      },
    ];

    const equipmentSiteId = "site-main";
    const filtered = batches.filter(
      (b) => !b.operating_site_id || b.operating_site_id === equipmentSiteId,
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("batch-main-1");
    expect(filtered[0].operating_site_name).toBe("清福本館");
  });
});
