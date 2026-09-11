import { dispatchCartQr } from "@/lib/laundry-cart/dispatch";
import { createLaundryOrderFromCartQr } from "@/lib/laundry-order/anonymous";

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
  const requestId = typeof body === "object" && body !== null && "change_request_id" in body ? body.change_request_id : null;
  const preview = typeof body === "object" && body !== null && "preview" in body && body.preview === true;
  const dispatch = await dispatchCartQr({ qrToken });
  if (dispatch.kind === "invalid" || dispatch.kind === "failed") {
    return Response.json(dispatch, { status: dispatch.kind === "failed" ? 503 : 400, headers: responseHeaders });
  }
  if (preview || (dispatch.kind === "dispatch" && dispatch.mode !== "anonymous_dropoff")) {
    return Response.json(dispatch, { status: 200, headers: responseHeaders });
  }
  const result = await createLaundryOrderFromCartQr({ qrToken, requestId });
  return Response.json(result, {
    status: result.kind === "failed" ? 503 : result.kind === "invalid" ? 400 : 200,
    headers: responseHeaders,
  });
}
