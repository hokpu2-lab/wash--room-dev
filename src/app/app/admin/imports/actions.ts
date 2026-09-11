"use server";

import { redirect } from "next/navigation";

import { commitImport, createImportPreview } from "@/lib/import-center/imports";

export async function previewImport(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect("/app/admin/bi?status=invalid#tab=imports");
  const result = await createImportPreview(file, String(formData.get("sheet") ?? ""));
  if (result.kind === "previewed") {
    redirect(`/app/admin/bi?status=previewed&id=${result.import_batch_id}&valid=${result.valid_rows}&invalid=${result.invalid_rows}#tab=imports`);
  }
  redirect(`/app/admin/bi?status=${result.kind}#tab=imports`);
}

export async function commitImportAction(formData: FormData) {
  const result = await commitImport(String(formData.get("import_batch_id") ?? ""));
  redirect(`/app/admin/bi?status=${result.kind}#tab=imports`);
}
