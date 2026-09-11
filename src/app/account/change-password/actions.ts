"use server";

import { redirect } from "next/navigation";

import { changeRequiredPassword } from "@/lib/auth/password-change";

export async function changeRequiredPasswordAction(formData: FormData) {
  const outcome = await changeRequiredPassword({
    currentPassword: formData.get("current_password"),
    newPassword: formData.get("new_password"),
    confirmation: formData.get("password_confirmation"),
  });

  if (outcome === "succeeded") redirect("/app");
  redirect(`/account/change-password?error=${outcome}`);
}
