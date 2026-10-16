"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  deleteUnusedLaundryEquipment,
  registerLaundryEquipment,
  reissueLaundryEquipmentQr,
  updateLaundryEquipment,
} from "@/lib/laundry-equipment/administration";
import { parseCleaningDurationConfig } from "@/lib/laundry-equipment/duration-config";

function text(value: FormDataEntryValue | null) { return typeof value === "string" ? value : ""; }
function list(formData: FormData, name: string) {
  const checked = formData.getAll(name).filter((value): value is string => typeof value === "string" && value.length > 0);
  if (checked.length > 0) return checked;
  const raw = text(formData.get(name));
  return raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : [];
}
const capacity = z.union([z.literal(""), z.coerce.number().int().min(1).max(20)]).transform((value) => value === "" ? null : value);
const duration = z.coerce.number().int().min(1).max(1440).catch(60);

export async function createLaundryEquipment(formData: FormData) {
  const parsedCapacity = capacity.safeParse(text(formData.get("capacity_kg")));
  const parsedDuration = duration.parse(formData.get("cleaning_duration_minutes"));
  const durationConfig = parseCleaningDurationConfig(formData.get("cleaning_duration_json"), parsedDuration);
  const result = await registerLaundryEquipment({
    name: text(formData.get("name")),
    siteCode: text(formData.get("site_code")),
    equipmentType: text(formData.get("equipment_type")),
    capacityKg: parsedCapacity.success ? parsedCapacity.data : null,
    cleaningDurationMinutes: durationConfig.default ?? parsedDuration,
    cleaningDurationConfig: durationConfig,
    categoryCodes: list(formData, "category_codes"),
    procedureTemplateIds: list(formData, "procedure_template_ids"),
    requestId: text(formData.get("change_request_id")),
    reason: text(formData.get("change_reason")),
  });
  if (result.kind === "applied" || result.kind === "already-applied") redirect(`/app/admin/laundry-equipment?equipment=applied`);
  redirect(`/app/admin/laundry-equipment?equipment=${result.kind === "invalid" ? "invalid" : "failed"}`);
}

export async function saveLaundryEquipment(formData: FormData) {
  const parsedCapacity = capacity.safeParse(text(formData.get("capacity_kg")));
  const parsedDuration = duration.parse(formData.get("cleaning_duration_minutes"));
  const durationConfig = parseCleaningDurationConfig(formData.get("cleaning_duration_json"), parsedDuration);
  const result = await updateLaundryEquipment({
    equipmentId: text(formData.get("laundry_equipment_id")),
    name: text(formData.get("name")),
    capacityKg: parsedCapacity.success ? parsedCapacity.data : null,
    cleaningDurationMinutes: durationConfig.default ?? parsedDuration,
    cleaningDurationConfig: durationConfig,
    status: text(formData.get("status")),
    categoryCodes: list(formData, "category_codes"),
    procedureTemplateIds: list(formData, "procedure_template_ids"),
    requestId: text(formData.get("change_request_id")),
    reason: text(formData.get("change_reason")),
  });
  if (result.kind === "applied" || result.kind === "already-applied") {
    redirect(`/app/admin/laundry-equipment?equipment=saved`);
  }
  const reasonCode = "reasonCode" in result ? result.reasonCode : undefined;
  const reasonQuery = reasonCode ? `&reason=${encodeURIComponent(reasonCode)}` : "";
  redirect(`/app/admin/laundry-equipment?equipment=${result.kind}${reasonQuery}`);
}

export async function reissueLaundryEquipmentQrAction(formData: FormData) {
  const confirmed = formData.get("reissue_confirmed");
  const result = await reissueLaundryEquipmentQr({ equipmentId: text(formData.get("laundry_equipment_id")), requestId: text(formData.get("change_request_id")), reason: text(formData.get("change_reason")), confirmed: confirmed === "on" });
  if (result.kind === "applied" || result.kind === "already-applied") redirect(`/app/admin/laundry-equipment/${result.equipmentId}/qr?qr=reissued&version=${result.qrVersion}`);
  if (result.kind === "invalid") redirect("/app/admin/laundry-equipment?equipment=invalid");
  redirect("/app/admin/laundry-equipment?equipment=failed");
}

export async function deleteLaundryEquipment(formData: FormData) {
  const result = await deleteUnusedLaundryEquipment({
    equipmentId: text(formData.get("laundry_equipment_id")),
    expectedName: text(formData.get("expected_equipment_name")),
    requestId: text(formData.get("change_request_id")),
    reason: text(formData.get("change_reason")),
    confirmed: formData.get("delete_confirmed") === "on",
  });
  if (result.kind === "applied" || result.kind === "already-applied") {
    redirect("/app/admin/laundry-equipment?equipment=deleted");
  }
  if (result.kind === "in-use") {
    redirect("/app/admin/laundry-equipment?equipment=delete-in-use");
  }
  if (result.kind === "name-mismatch") {
    redirect("/app/admin/laundry-equipment?equipment=delete-name-mismatch");
  }
  if (result.kind === "denied") {
    redirect("/app/admin/laundry-equipment?equipment=delete-denied");
  }
  redirect("/app/admin/laundry-equipment?equipment=delete-invalid");
}
