"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  createLaundryCategory,
  createProcedureTemplateDraft,
  publishProcedureTemplateVersion,
  setProcedureTemplateActive,
  updateLaundryCategory,
  updateProcedureTemplateDraft,
} from "@/lib/procedure/template";

function textValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

const booleanField = z.enum(["true", "false"]).transform((value) => value === "true");

function redirectResult(result: { kind: string }, base: string) {
  if (result.kind === "invalid") redirect(`${base}?procedure=invalid`);
  if (result.kind === "failed") redirect(`${base}?procedure=failed`);
  redirect(`${base}?procedure=applied`);
}

export async function saveLaundryCategory(formData: FormData) {
  const categoryId = textValue(formData.get("category_id"));
  const active = booleanField.safeParse(formData.get("category_active"));
  if (!active.success) redirect("/app/admin/procedures?procedure=invalid");
  const input = {
    code: textValue(formData.get("category_code")),
    name: textValue(formData.get("category_name")),
    sortOrder: Number(textValue(formData.get("sort_order"))),
    active: active.data,
    requestId: textValue(formData.get("change_request_id")),
    reason: textValue(formData.get("change_reason")),
  };
  const result = categoryId
    ? await updateLaundryCategory({ ...input, categoryId })
    : await createLaundryCategory(input);
  redirectResult(result, "/app/admin/procedures");
}

export async function saveProcedureDraft(formData: FormData) {
  const templateId = textValue(formData.get("template_id"));
  const versionId = textValue(formData.get("version_id"));
  const input = {
    name: textValue(formData.get("template_name")),
    stagesJson: textValue(formData.get("stages_json")),
    requestId: textValue(formData.get("change_request_id")),
    reason: textValue(formData.get("change_reason")),
  };
  const result = versionId
    ? await updateProcedureTemplateDraft({ ...input, versionId })
    : await createProcedureTemplateDraft({
        ...input,
        templateId: templateId || null,
        siteCode: textValue(formData.get("site_code")),
        categoryCode: textValue(formData.get("category_code")),
      });
  redirectResult(result, "/app/admin/procedures");
}

export async function publishProcedureDraft(formData: FormData) {
  const result = await publishProcedureTemplateVersion({
    versionId: textValue(formData.get("version_id")),
    requestId: textValue(formData.get("change_request_id")),
    reason: textValue(formData.get("change_reason")),
  });
  redirectResult(result, "/app/admin/procedures");
}

export async function toggleProcedureTemplate(formData: FormData) {
  const active = booleanField.safeParse(formData.get("target_active"));
  if (!active.success) redirect("/app/admin/procedures?procedure=invalid");
  const result = await setProcedureTemplateActive({
    templateId: textValue(formData.get("template_id")),
    active: active.data,
    requestId: textValue(formData.get("change_request_id")),
    reason: textValue(formData.get("change_reason")),
  });
  redirectResult(result, "/app/admin/procedures");
}
