import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function pdfForRows(rows: string[][]) {
  const lines = rows.map((row) => row.join(" | ")).join("\\n");
  const stream = `BT /F1 10 Tf 36 760 Td (${lines.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  return `%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources<< /Font<< /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n5 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj\ntrailer<< /Root 1 0 R >>\n%%EOF`;
}

export async function GET(request: Request) {
  const principal = await requireRole("laundry_supervisor");
  const siteId = principal.memberships.find((membership) => isLaundrySupervisorRole(membership.role))?.operating_site_id;
  if (!siteId) return NextResponse.json({ error: "scope" }, { status: 403 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (!(["csv", "xlsx", "pdf"] as const).includes(format as "csv" | "xlsx" | "pdf")) return NextResponse.json({ error: "format" }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("laundry_orders").select("order_number,status,created_at,updated_at").eq("operating_site_id", siteId).order("created_at", { ascending: false }).limit(5000);
  if (error) return NextResponse.json({ error: "export unavailable" }, { status: 503 });
  const rows = [["order_number", "status", "created_at", "updated_at"], ...(data ?? []).map((row) => [row.order_number, row.status, row.created_at, row.updated_at])];
  const filename = `laundry-orders-${new Date().toISOString().slice(0, 10)}.${format}`;
  const headers = { "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${filename}"`, "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  if (format === "csv") return new NextResponse(rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n"), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  if (format === "xlsx") { const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "orders"); const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer; return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }); }
  return new NextResponse(pdfForRows(rows), { headers: { ...headers, "Content-Type": "application/pdf" } });
}
