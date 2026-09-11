import { renderLaundryEquipmentQrSvg } from "@/lib/laundry-equipment/administration";

const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
} as const;

function safeFilename(name: string) {
  const ascii = name.replace(/[^\w.\- ]+/g, "-").replace(/^-+|-+$/g, "").trim();
  return `${ascii || "equipment"}-fixed-qr.svg`;
}

export async function GET(request: Request, context: { params: Promise<{ equipmentId: string }> }) {
  const { equipmentId } = await context.params;
  try {
    const qr = await renderLaundryEquipmentQrSvg(equipmentId, new URL(request.url).origin);
    if (!qr) return new Response("Not found", { status: 404, headers });
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(qr.svg, {
      headers: {
        ...headers,
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `${disposition}; filename="${safeFilename(qr.equipmentName)}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404, headers });
  }
}
