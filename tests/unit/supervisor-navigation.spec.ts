import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { supervisorLinks, workerLinks } from "../../src/app/app/workspace-shell";

describe("洗衣主管導覽連結與控制點覆核", () => {
  it("確認洗衣主管工作台導覽連結包含「洗衣員作業台」與「批次控制與重排」", () => {
    const operationsLink = supervisorLinks.find((l) => l.href === "/app/operations");
    expect(operationsLink).toBeDefined();
    expect(operationsLink?.label).toBe("洗衣員作業台");
    expect(operationsLink?.group).toBe("workspace");

    const controlCenterLink = supervisorLinks.find((l) => l.href === "/app/operations/control-center");
    expect(controlCenterLink).toBeDefined();
    expect(controlCenterLink?.label).toBe("批次控制與重排");
    expect(controlCenterLink?.group).toBe("workspace");
  });

  it("確認洗衣員導覽連結包含「批次控制與重排」", () => {
    const controlCenterLink = workerLinks.find((l) => l.href === "/app/operations/control-center");
    expect(controlCenterLink).toBeDefined();
    expect(controlCenterLink?.label).toBe("洗衣單與批次");
    expect(controlCenterLink?.description).toContain("批次控制、異常與重排");
  });
});
