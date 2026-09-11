import "server-only";

import QRCode from "qrcode";

import { getApplicationOrigin } from "@/lib/supabase/config";

type FixedAssetQrInput = {
  scanPath: `/${string}`;
  fragmentCredential: string;
  label: string;
  fragmentNamespace?: "cart" | "equipment";
  assetId?: string;
  origin?: string;
};

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}

function resolveQrOrigin(origin?: string) {
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      /* fall through */
    }
  }
  try {
    return getApplicationOrigin();
  } catch {
    return "https://wash-room.vercel.app";
  }
}

export function renderFixedAssetQrSvg({
  scanPath,
  fragmentCredential,
  label,
  fragmentNamespace = "cart",
  assetId,
  origin,
}: FixedAssetQrInput) {
  const encodedPath =
    fragmentNamespace === "equipment" && assetId
      ? `${scanPath}/e/${assetId}`
      : scanPath;
  const scanUrl = new URL(encodedPath, resolveQrOrigin(origin));
  scanUrl.hash = `v1.${fragmentNamespace}.${fragmentCredential}`;

  const symbol = QRCode.create(scanUrl.toString(), {
    errorCorrectionLevel: "Q",
  });
  const margin = 4;
  const qrExtent = symbol.modules.size + margin * 2;
  const labelHeight = 7;
  const labelFontSize = Math.min(
    3.2,
    (qrExtent - margin * 2) / Math.max(label.length, 1),
  );
  const path: string[] = [];

  for (let row = 0; row < symbol.modules.size; row += 1) {
    for (let column = 0; column < symbol.modules.size; column += 1) {
      if (symbol.modules.get(row, column)) {
        path.push(`M${column + margin} ${row + margin}h1v1h-1z`);
      }
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="720" viewBox="0 0 ${qrExtent} ${qrExtent + labelHeight}" shape-rendering="crispEdges">`,
    `<rect width="${qrExtent}" height="${qrExtent + labelHeight}" fill="#ffffff"/>`,
    `<path d="${path.join("")}" fill="#102b27"/>`,
    `<text x="${qrExtent / 2}" y="${qrExtent + 4.5}" text-anchor="middle" fill="#102b27" font-family="Arial, sans-serif" font-size="${labelFontSize}" font-weight="700">${escapeXml(label)}</text>`,
    "</svg>",
  ].join("");
}
