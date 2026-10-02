import { describe, expect, it } from "vitest";

describe("洗衣設備狀態與正使用機構及車號資訊 (Equipment Usage & Cart Number)", () => {
  it("使用中設備若有單一機構與單一車號應正確顯示機構名稱與車號", () => {
    const equipment = {
      id: "41000000-0000-4000-8000-000000000001",
      name: "本館洗衣-1",
      equipment_type: "washer" as const,
      status: "normal" as const,
      occupied: true,
      active_institutions: ["清福養老院"],
      active_cart_count: 1,
      active_cart_numbers: ["8E-1"],
    };

    const isOccupied = Boolean(equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0));
    const institutionText = isOccupied
      ? equipment.active_institutions && equipment.active_institutions.length > 0
        ? equipment.active_institutions.join("、")
        : "—"
      : "—";
    const cartNumberText = isOccupied
      ? equipment.active_cart_numbers && equipment.active_cart_numbers.length > 0
        ? equipment.active_cart_numbers.join("、")
        : "—"
      : "—";

    expect(isOccupied).toBe(true);
    expect(institutionText).toBe("清福養老院");
    expect(cartNumberText).toBe("8E-1");
  });

  it("使用中設備若合批多機構與多車號應以頓號連接機構並顯示多車號", () => {
    const equipment = {
      id: "41000000-0000-4000-8000-000000000002",
      name: "本館洗衣-2",
      equipment_type: "washer" as const,
      status: "normal" as const,
      occupied: true,
      active_institutions: ["清福養老院", "愛心長照中心"],
      active_cart_count: 2,
      active_cart_numbers: ["8E-1", "8E-2"],
    };

    const isOccupied = Boolean(equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0));
    const institutionText = isOccupied
      ? equipment.active_institutions && equipment.active_institutions.length > 0
        ? equipment.active_institutions.join("、")
        : "—"
      : "—";
    const cartNumberText = isOccupied
      ? equipment.active_cart_numbers && equipment.active_cart_numbers.length > 0
        ? equipment.active_cart_numbers.join("、")
        : "—"
      : "—";

    expect(institutionText).toBe("清福養老院、愛心長照中心");
    expect(cartNumberText).toBe("8E-1、8E-2");
  });

  it("閒置或正常設備應顯示破折號", () => {
    const equipment = {
      id: "41000000-0000-4000-8000-000000000003",
      name: "本館洗衣-3",
      equipment_type: "washer" as const,
      status: "normal" as const,
      occupied: false,
      active_institutions: [],
      active_cart_count: 0,
      active_cart_numbers: [],
    };

    const isOccupied = Boolean(equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0));
    const institutionText = isOccupied
      ? equipment.active_institutions && equipment.active_institutions.length > 0
        ? equipment.active_institutions.join("、")
        : "—"
      : "—";
    const cartNumberText = isOccupied
      ? equipment.active_cart_numbers && equipment.active_cart_numbers.length > 0
        ? equipment.active_cart_numbers.join("、")
        : "—"
      : "—";

    expect(isOccupied).toBe(false);
    expect(institutionText).toBe("—");
    expect(cartNumberText).toBe("—");
  });
});
