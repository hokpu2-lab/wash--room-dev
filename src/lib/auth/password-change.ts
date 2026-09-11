import "server-only";

import { z } from "zod";

import { getPublicSupabaseConfiguration } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const securityStateSchema = z.array(
  z.object({
    login_name: z.string(),
    password_change_required: z.boolean(),
  }),
);

const passwordCommandSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z
      .string()
      .min(12)
      .max(128)
      .regex(/[a-z]/)
      .regex(/[A-Z]/)
      .regex(/[0-9]/)
      .regex(/[^A-Za-z0-9]/),
    confirmation: z.string().min(1).max(128),
  })
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmation) {
      context.addIssue({ code: "custom", message: "passwords_do_not_match" });
    }
    if (value.newPassword === value.currentPassword) {
      context.addIssue({ code: "custom", message: "password_not_changed" });
    }
  });

export type PasswordChangeState =
  | { kind: "anonymous" }
  | { kind: "unavailable" }
  | { kind: "not_required" }
  | { kind: "required"; loginName: string };

export async function getPasswordChangeState(): Promise<PasswordChangeState> {
  if (!getPublicSupabaseConfiguration()) return { kind: "anonymous" };

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { kind: "anonymous" };

  const { data, error } = await supabase.rpc("current_account_security_state");
  const state = securityStateSchema.safeParse(data);
  if (error || !state.success || state.data.length !== 1) {
    return { kind: "unavailable" };
  }

  if (!state.data[0].password_change_required) return { kind: "not_required" };

  return { kind: "required", loginName: state.data[0].login_name };
}

export type PasswordChangeOutcome =
  | "succeeded"
  | "invalid"
  | "current_password_incorrect"
  | "failed";

export async function changeRequiredPassword(input: {
  currentPassword: unknown;
  newPassword: unknown;
  confirmation: unknown;
}): Promise<PasswordChangeOutcome> {
  const command = passwordCommandSchema.safeParse(input);
  if (!command.success) return "invalid";

  const state = await getPasswordChangeState();
  if (state.kind !== "required") return "failed";

  const supabase = await createServerSupabaseClient({
    cookieWritesRequired: true,
  });

  const { error: updateError } = await supabase.auth.updateUser({
    password: command.data.newPassword,
    current_password: command.data.currentPassword,
  });
  if (updateError) return "current_password_incorrect";

  const { data: completed, error: completionError } = await supabase.rpc(
    "complete_required_password_change",
  );
  if (completionError || completed !== true) return "failed";

  return "succeeded";
}
