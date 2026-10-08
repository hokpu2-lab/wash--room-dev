import { describe, expect, it } from "vitest";

describe("洗衣設備狀態與正使用車號資訊 (Equipment Usage & Cart Number)", () => {
  it("使用中設備若有單一車號應正確顯示車號", () => {
    const equipment = {
      id: "41000000-0000-4000-8000-000000000001",
      name: "本館洗衣-1",
      equipment_type: "washer" as const,
      status: "normal" as const,
      occupied: true,
      active_cart_count: 1,
      active_cart_numbers: ["8E-1"],
    };

    const isOccupied = Boolean(equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0));
    const cartNumberText = isOccupied
      ? equipment.active_cart_numbers && equipment.active_cart_numbers.length > 0
        ? equipment.active_cart_numbers.join("、")
        : "—"
      : "—";

    expect(isOccupied).toBe(true);
    expect(cartNumberText).toBe("8E-1");
  });

  it("使用中設備若合批多車號應以頓號連接顯示", () => {
    const equipment = {
      id: "41000000-0000-4000-8000-000000000002",
      name: "本館洗衣-2",
      equipment_type: "washer" as const,
      status: "normal" as const,
      occupied: true,
      active_cart_count: 2,
      active_cart_numbers: ["8E-1", "8E-2"],
    };

    const isOccupied = Boolean(equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0));
    const cartNumberText = isOccupied
      ? equipment.active_cart_numbers && equipment.active_cart_numbers.length > 0
        ? equipment.active_cart_numbers.join("、")
        : "—"
      : "—";

    expect(cartNumberText).toBe("8E-1、8E-2");
  });

  it("本館消毒鍋使用中應正確顯示機構為護家、車號為 2C-6", () => {
    const equipment = {
      id: "41000000-0000-4000-8000-000000000097",
      name: "本館消毒鍋",
      equipment_type: "disinfection_tank" as const,
      status: "normal" as const,
      occupied: true,
      active_cart_count: 1,
      active_institutions: ["護家"],
      active_cart_numbers: ["2C-6"],
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
    expect(institutionText).toBe("護家");
    expect(cartNumberText).toBe("2C-6");
  });
});
