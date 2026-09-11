import { dispatchEquipmentQr } from "@/lib/laundry-equipment/dispatch";

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function POST(request: Request) {
  let body: unknown;
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return Response.json({ kind: "invalid", reasonCode: "invalid_request" }, { status: 400, headers: responseHeaders });
    }
    body = await request.json();
  } catch {
    return Response.json({ kind: "invalid", reasonCode: "invalid_request" }, { status: 400, headers: responseHeaders });
  }
  const qrToken = typeof body === "object" && body !== null && "qr_token" in body ? body.qr_token : null;
  const equipmentId =
    typeof body === "object" && body !== null && "equipment_id" in body ? body.equipment_id : null;
  const result = await dispatchEquipmentQr({ qrToken, equipmentId });
  return Response.json(result, {
    status: result.kind === "failed" ? 503 : result.kind === "invalid" ? 400 : result.kind === "denied" ? 403 : 200,
    headers: responseHeaders,
  });
}
