import { getPickupCartInfo, pickupLaundryOrder } from "@/lib/laundry-order/pickup";

const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cartNumber = searchParams.get("cart");
  if (!cartNumber) {
    return Response.json(
      { found: false, reasonCode: "cart_not_found" },
      { status: 400, headers }
    );
  }
  const info = await getPickupCartInfo(cartNumber);
  return Response.json(info, { status: 200, headers });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return Response.json({ kind: "invalid", reasonCode: "invalid_request" }, { status: 400, headers });
    }
    body = await request.json();
  } catch {
    return Response.json({ kind: "invalid", reasonCode: "invalid_request" }, { status: 400, headers });
  }

  const value = typeof body === "object" && body !== null ? body : {};
  const qrToken = "qr_token" in value && typeof value.qr_token === "string" ? value.qr_token : null;
  const cartNumber = "cart_number" in value && typeof value.cart_number === "string" ? value.cart_number : null;
  const orderNumber = "order_number" in value && typeof value.order_number === "string" ? value.order_number : null;
  const orderId = "order_id" in value && typeof value.order_id === "string" ? value.order_id : null;
  const categoryName = "category_name" in value && typeof value.category_name === "string" ? value.category_name : null;
  const requestId = "change_request_id" in value && typeof value.change_request_id === "string" ? value.change_request_id : null;

  const result = await pickupLaundryOrder({
    qrToken,
    cartNumber,
    orderNumber,
    orderId,
    categoryName,
    requestId,
  });

  return Response.json(result, {
    status: result.kind === "failed" ? 503 : result.kind === "invalid" ? 400 : 200,
    headers,
  });
}
