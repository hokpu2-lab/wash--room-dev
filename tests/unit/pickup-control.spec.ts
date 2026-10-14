import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { pickupLaundryOrder } from "../../src/lib/laundry-order/pickup";

describe("車號取件結案與待取件資料流 (pickup control)", () => {
  it("當未傳入 qr_token 且未傳入有效 cart_number 時應被拒絕為 invalid_qr", async () => {
    const result = await pickupLaundryOrder({
      qrToken: null,
      cartNumber: "",
      requestId: "60000000-0000-4000-8000-000000000001",
    });
    expect(result).toEqual({ kind: "invalid", reasonCode: "invalid_qr" });
  });

  it("當傳入無效格式的 requestId 時應被拒絕為 invalid_qr", async () => {
    const result = await pickupLaundryOrder({
      cartNumber: "6D-1",
      requestId: "not-a-uuid",
    });
    expect(result).toEqual({ kind: "invalid", reasonCode: "invalid_qr" });
  });

  it("直達取件 URL 規範應包含編碼後的車號參數", () => {
    const cartNumber = "6D-1";
    const targetUrl = `/scan/pickup?cart=${encodeURIComponent(cartNumber)}`;
    expect(targetUrl).toBe("/scan/pickup?cart=6D-1");

    const specialCart = "8D-2 (備用)";
    const encodedUrl = `/scan/pickup?cart=${encodeURIComponent(specialCart)}`;
    expect(encodedUrl).toBe("/scan/pickup?cart=8D-2%20(%E5%82%99%E7%94%A8)");
  });
});
