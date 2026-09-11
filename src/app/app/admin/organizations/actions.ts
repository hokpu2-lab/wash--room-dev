"use server";

import { redirect } from "next/navigation";

import { applyInstitutionChange } from "@/lib/organization/master-data";

function textValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

export async function saveInstitution(formData: FormData) {
  const result = await applyInstitutionChange({
    code: textValue(formData.get("institution_code")),
    name: textValue(formData.get("institution_name")),
    siteCode: textValue(formData.get("target_site_code")),
    active: formData.get("institution_active") === "on",
    requestId: textValue(formData.get("change_request_id")),
    reason: textValue(formData.get("change_reason")),
  });

  if (result.kind === "invalid") {
    redirect("/app/admin/organizations?organization=invalid");
  }

  if (result.kind === "failed") {
    redirect("/app/admin/organizations?organization=failed");
  }

  redirect(
    `/app/admin/organizations?organization=applied&code=${encodeURIComponent(result.code)}`,
  );
}
