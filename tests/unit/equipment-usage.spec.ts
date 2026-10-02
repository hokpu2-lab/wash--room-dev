import { describe, expect, it } from "vitest";

describe("洗衣設備狀態與正使用機構及桶數資訊 (Equipment Usage & Cart Count)", () => {
  it("使用中設備若有單一機構與 1 桶應正確顯示機構名稱與桶數", () => {
    const equipment = {
      id: "41000000-0000-4000-8000-000000000001",
      name: "本館洗衣-1",
      equipment_type: "washer" as const,
      status: "normal" as const,
      occupied: true,
      active_institutions: ["清福養老院"],
      active_cart_count: 1,
    };

    const isOccupied = Boolean(equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0));
    const institutionText = isOccupied
      ? equipment.active_institutions && equipment.active_institutions.length > 0
        ? equipment.active_institutions.join("、")
        : "使用中"
      : "—";
    const cartCountText = isOccupied
      ? `${equipment.active_cart_count && equipment.active_cart_count > 0 ? equipment.active_cart_count : 1} 桶`
      : "—";

    expect(isOccupied).toBe(true);
    expect(institutionText).toBe("清福養老院");
    expect(cartCountText).toBe("1 桶");
  });

  it("使用中設備若合批多機構與多桶應以頓號連接機構並顯示累計桶數", () => {
    const equipment = {
      id: "41000000-0000-4000-8000-000000000002",
      name: "本館洗衣-2",
      equipment_type: "washer" as const,
      status: "normal" as const,
      occupied: true,
      active_institutions: ["清福養老院", "愛心長照中心"],
      active_cart_count: 2,
    };

    const isOccupied = Boolean(equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0));
    const institutionText = isOccupied
      ? equipment.active_institutions && equipment.active_institutions.length > 0
        ? equipment.active_institutions.join("、")
        : "使用中"
      : "—";
    const cartCountText = isOccupied
      ? `${equipment.active_cart_count && equipment.active_cart_count > 0 ? equipment.active_cart_count : 1} 桶`
      : "—";

    expect(institutionText).toBe("清福養老院、愛心長照中心");
    expect(cartCountText).toBe("2 桶");
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
    };

    const isOccupied = Boolean(equipment.occupied || (equipment.active_cart_count && equipment.active_cart_count > 0));
    const institutionText = isOccupied
      ? equipment.active_institutions && equipment.active_institutions.length > 0
        ? equipment.active_institutions.join("、")
        : "使用中"
      : "—";
    const cartCountText = isOccupied
      ? `${equipment.active_cart_count && equipment.active_cart_count > 0 ? equipment.active_cart_count : 1} 桶`
      : "—";

    expect(isOccupied).toBe(false);
    expect(institutionText).toBe("—");
    expect(cartCountText).toBe("—");
  });
});
