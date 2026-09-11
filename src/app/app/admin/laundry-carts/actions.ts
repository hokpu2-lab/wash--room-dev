"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  registerLaundryCart,
  reissueLaundryCartQr,
  setLaundryCartActive,
} from "@/lib/laundry-cart/administration";

function textValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

const targetActiveSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export async function createLaundryCart(formData: FormData) {
  const result = await registerLaundryCart({
    cartNumber: textValue(formData.get("cart_number")),
    institutionCode: textValue(formData.get("institution_code")),
    requestId: textValue(formData.get("change_request_id")),
    reason: textValue(formData.get("change_reason")),
  });

  if (result.kind === "invalid") {
    redirect("/app/admin/laundry-carts?cart=invalid");
  }

  if (result.kind === "applied" || result.kind === "already-applied") {
    redirect(
      `/app/admin/laundry-carts?cart=applied&number=${encodeURIComponent(result.cartNumber)}`,
    );
  }

  redirect("/app/admin/laundry-carts?cart=failed");
}

export async function changeLaundryCartActive(formData: FormData) {
  const active = targetActiveSchema.safeParse(formData.get("target_active"));
  if (!active.success) {
    redirect("/app/admin/laundry-carts?cart=invalid");
  }

  const cartNumber = textValue(formData.get("cart_number"));
  const result = await setLaundryCartActive({
    cartId: textValue(formData.get("laundry_cart_id")),
    active: active.data,
    requestId: textValue(formData.get("change_request_id")),
    reason: textValue(formData.get("change_reason")),
  });

  if (result.kind === "invalid") {
    redirect("/app/admin/laundry-carts?cart=invalid");
  }

  if (result.kind === "applied" || result.kind === "already-applied") {
    const state = result.active ? "activated" : "deactivated";
    redirect(
      `/app/admin/laundry-carts?cart=${state}&number=${encodeURIComponent(cartNumber)}`,
    );
  }

  redirect("/app/admin/laundry-carts?cart=failed");
}

export async function reissueLaundryCartQrAction(formData: FormData) {
  const result = await reissueLaundryCartQr({
    cartId: textValue(formData.get("laundry_cart_id")),
    requestId: textValue(formData.get("change_request_id")),
    reason: textValue(formData.get("change_reason")),
    confirmed: formData.get("reissue_confirmed") === "on",
  });

  if (result.kind === "applied" || result.kind === "already-applied") {
    redirect(
      `/app/admin/laundry-carts/${result.cartId}/qr?qr=reissued&version=${result.qrVersion}`,
    );
  }

  if (result.kind === "invalid") {
    redirect("/app/admin/laundry-carts?cart=invalid");
  }

  redirect("/app/admin/laundry-carts?cart=failed");
}
