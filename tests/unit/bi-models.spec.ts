import { expect, test } from "vitest";

import {
  biLayoutExamples,
  biSampleModels,
  parseBiRunResult,
} from "../../src/lib/analytics/bi-models";

test("內建 BI 樣本模型都只使用安全白名單維度與指標", () => {
  expect(biSampleModels.map((model) => model.id)).toEqual([
    "flow-health",
    "category-throughput",
    "site-capacity",
    "pickup-readiness",
  ]);
  for (const model of biSampleModels) {
    expect(model.dimensions.length).toBeGreaterThan(0);
    expect(model.metrics.length).toBeGreaterThan(0);
  }
});

test("BI 版面範例只對應既有白名單模型", () => {
  expect(biLayoutExamples.map((example) => example.id)).toEqual([
    "operations-command",
    "workload-capacity",
    "site-comparison",
    "pickup-readiness",
  ]);
  for (const example of biLayoutExamples) {
    expect(biSampleModels.some((model) => model.id === example.modelId)).toBe(true);
    expect(example.blocks.length).toBeGreaterThanOrEqual(3);
  }
});

test("BI 分組結果只接受受控的結果形狀", () => {
  expect(parseBiRunResult({
    outcome: "ok",
    view_id: "60000000-0000-4000-8000-000000001401",
    site_id: "20000000-0000-4000-8000-000000000099",
    dimensions: ["status"],
    metrics: ["order_count", "completed_count"],
    rows: [{ label: "待取件", order_count: 3, batch_count: null, completed_count: 4 }],
  })).toMatchObject({ rows: [{ label: "待取件", order_count: 3 }] });
  expect(parseBiRunResult({ outcome: "ok", rows: [] })).toBeNull();
});
