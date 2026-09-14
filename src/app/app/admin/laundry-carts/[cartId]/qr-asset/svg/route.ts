import { renderLaundryCartQrSvg } from "@/lib/laundry-cart/administration";

const privateAssetHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Content-Security-Policy":
    "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "Vercel-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

type LaundryCartQrAssetContext = {
  params: Promise<{ cartId: string }>;
};

export async function GET(
  request: Request,
  context: LaundryCartQrAssetContext,
) {
  const { cartId } = await context.params;
  const qr = await renderLaundryCartQrSvg(cartId, new URL(request.url).origin);

  if (!qr) {
    return new Response("Not found", {
      status: 404,
      headers: privateAssetHeaders,
    });
  }

  const disposition = new URL(request.url).searchParams.get("download") === "1"
    ? "attachment"
    : "inline";

  return new Response(qr.svg, {
    headers: {
      ...privateAssetHeaders,
      "Content-Disposition": `${disposition}; filename="${qr.cartNumber}-fixed-qr.svg"`,
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}
