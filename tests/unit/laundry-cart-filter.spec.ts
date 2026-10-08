import { describe, expect, it } from "vitest";

describe("洗衣車清單依照送洗機構標籤篩選 (Laundry Cart Filter by Institution)", () => {
  const mockCarts = [
    {
      id: "c1",
      cart_number: "2C-6",
      active: true,
      has_ready_pickup: false,
      institutions: { code: "CARE-NURSING", name: "護理之家", operating_sites: { code: "MAIN", name: "本館" } },
    },
    {
      id: "c2",
      cart_number: "2D-1",
      active: true,
      has_ready_pickup: false,
      institutions: { code: "CARE-NURSING", name: "護理之家", operating_sites: { code: "MAIN", name: "本館" } },
    },
    {
      id: "c3",
      cart_number: "8D-1",
      active: true,
      has_ready_pickup: true,
      institutions: { code: "CARE-ELDERLY", name: "養護中心", operating_sites: { code: "MAIN", name: "本館" } },
    },
    {
      id: "c4",
      cart_number: "8E-1",
      active: false,
      has_ready_pickup: false,
      institutions: { code: "CARE-LONGTERM", name: "長照中心", operating_sites: { code: "MAIN", name: "本館" } },
    },
  ];

  const mockInstitutions = [
    { id: "i1", code: "CARE-NURSING", name: "護理之家", operating_sites: { code: "MAIN", name: "本館" } },
    { id: "i2", code: "CARE-ELDERLY", name: "養護中心", operating_sites: { code: "MAIN", name: "本館" } },
    { id: "i3", code: "CARE-LONGTERM", name: "長照中心", operating_sites: { code: "MAIN", name: "本館" } },
    { id: "i4", code: "CARE-DAYCARE", name: "日照中心", operating_sites: { code: "MAIN", name: "本館" } },
  ];

  it("未選擇特定機構標籤時應呈現全部洗衣車", () => {
    const selectedInstitutionCode: string | null = null;
    const filtered = selectedInstitutionCode
      ? mockCarts.filter((cart) => cart.institutions.code === selectedInstitutionCode)
      : mockCarts;

    expect(filtered.length).toBe(4);
    expect(filtered.map((c) => c.cart_number)).toEqual(["2C-6", "2D-1", "8D-1", "8E-1"]);
  });

  it("選取「護理之家」標籤時只應包含護理之家的洗衣車", () => {
    const selectedInstitutionCode = "CARE-NURSING";
    const filtered = mockCarts.filter((cart) => cart.institutions.code === selectedInstitutionCode);

    expect(filtered.length).toBe(2);
    expect(filtered.map((c) => c.cart_number)).toEqual(["2C-6", "2D-1"]);
    expect(filtered.every((c) => c.institutions.code === "CARE-NURSING")).toBe(true);
  });

  it("選取「養護中心」標籤時只應包含養護中心的洗衣車", () => {
    const selectedInstitutionCode = "CARE-ELDERLY";
    const filtered = mockCarts.filter((cart) => cart.institutions.code === selectedInstitutionCode);

    expect(filtered.length).toBe(1);
    expect(filtered[0].cart_number).toBe("8D-1");
  });

  it("選取尚無車輛的「日照中心」標籤時應回傳空清單", () => {
    const selectedInstitutionCode = "CARE-DAYCARE";
    const filtered = mockCarts.filter((cart) => cart.institutions.code === selectedInstitutionCode);

    expect(filtered.length).toBe(0);
  });

  it("各機構標籤上的車輛數量計算應正確", () => {
    const counts = mockInstitutions.map((inst) => ({
      name: inst.name,
      count: mockCarts.filter((c) => c.institutions.code === inst.code).length,
    }));

    expect(counts).toEqual([
      { name: "護理之家", count: 2 },
      { name: "養護中心", count: 1 },
      { name: "長照中心", count: 1 },
      { name: "日照中心", count: 0 },
    ]);
  });
});
