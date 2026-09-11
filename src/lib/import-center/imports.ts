import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { z } from "zod";

import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const resultSchema = z.array(z.object({
  import_batch_id: z.uuid(),
  total_rows: z.number(),
  valid_rows: z.number(),
  invalid_rows: z.number(),
  outcome: z.string(),
  reason_code: z.string(),
}));

function firstSiteId(memberships: Awaited<ReturnType<typeof requireRole>>["memberships"]) {
  return memberships.find((membership) => isLaundrySupervisorRole(membership.role))?.operating_site_id ?? null;
}

export async function createImportPreview(file: File, sheetName?: string) {
  const principal = await requireRole("laundry_supervisor");
  const siteId = firstSiteId(principal.memberships);
  if (!siteId || file.size > 5 * 1024 * 1024) return { kind: "invalid" as const };
  const bytes = Buffer.from(await file.arrayBuffer());
  const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
  let rows: Record<string, unknown>[];
  let selectedSheet = sheetName ?? "";
  if (isXlsx) {
    const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
    selectedSheet = selectedSheet || workbook.SheetNames[0] || "";
    const sheet = workbook.Sheets[selectedSheet];
    if (!sheet) return { kind: "invalid" as const };
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  } else {
    rows = parse(bytes.toString("utf8"), { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, unknown>[];
  }
  if (rows.length > 5000) return { kind: "invalid" as const };
  const normalizedRows = rows.map((row) => ({
    order_number: String(row.order_number ?? row["洗衣單號"] ?? ""),
    cart_number: String(row.cart_number ?? row["洗衣車號"] ?? ""),
    category_code: String(row.category_code ?? row["分類代碼"] ?? ""),
  }));
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("create_laundry_import_preview", {
    target_file_name: file.name,
    target_format: isXlsx ? "xlsx" : "csv",
    target_sha256: createHash("sha256").update(bytes).digest("hex"),
    target_site_id: siteId,
    target_sheet: selectedSheet,
    target_rows: normalizedRows,
    change_request_id: randomUUID(),
  });
  const parsed = resultSchema.safeParse(data);
  if (error || !parsed.success || parsed.data.length !== 1) return { kind: "failed" as const };
  return { kind: "previewed" as const, ...parsed.data[0] };
}

export async function commitImport(importBatchId: string) {
  await requireRole("laundry_supervisor");
  const parsedId = z.uuid().safeParse(importBatchId);
  if (!parsedId.success) return { kind: "invalid" as const };
  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("commit_laundry_import_preview", {
    target_import_batch_id: parsedId.data,
    change_request_id: randomUUID(),
  });
  if (error || !Array.isArray(data) || data.length !== 1) return { kind: "failed" as const };
  return { kind: "committed" as const, ...data[0] };
}
