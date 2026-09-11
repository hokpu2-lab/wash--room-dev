"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { accessRoleSchema, primaryRoleEntryPath } from "@/lib/auth/access-role";
import { internalAuthEmail, loginNameSchema } from "@/lib/auth/account-management-schema";
import { getPublicSupabaseConfiguration } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  loginName: loginNameSchema,
  password: z.string().min(1).max(256),
});

const authorizationDecisionSchema = z.array(
  z.object({
    authorized: z.boolean(),
    denial_code: z.string().nullable(),
  }),
);

const principalPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anonymous") }),
  z.object({ kind: z.literal("denied") }),
  z.object({ kind: z.literal("password_change_required") }),
  z.object({
    kind: z.literal("authorized"),
    memberships: z.array(z.object({ role: accessRoleSchema })).min(1),
  }),
]);

export async function signInWithPassword(formData: FormData) {
  if (!getPublicSupabaseConfiguration()) {
    redirect("/login?error=configuration");
  }

  const credentials = credentialsSchema.safeParse({
    loginName: formData.get("login_name"),
    password: formData.get("password"),
  });
  if (!credentials.success) {
    redirect("/login?error=credentials");
  }

  const supabase = await createServerSupabaseClient({
    cookieWritesRequired: true,
  });
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: internalAuthEmail(credentials.data.loginName),
    password: credentials.data.password,
  });

  if (signInError) {
    redirect("/login?error=credentials");
  }

  const { data: authorizationData, error: authorizationError } =
    await supabase.rpc("authorize_current_user");
  const authorization = authorizationDecisionSchema.safeParse(
    authorizationData,
  );

  if (
    authorizationError ||
    !authorization.success ||
    authorization.data.length !== 1 ||
    !authorization.data[0].authorized
  ) {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/auth/denied");
  }

  const { data: securityData, error: securityError } = await supabase.rpc(
    "current_account_security_state",
  );
  const exactSecurityState = z
    .array(z.object({ login_name: z.string(), password_change_required: z.boolean() }))
    .safeParse(securityData);
  if (
    securityError ||
    !exactSecurityState.success ||
    exactSecurityState.data.length !== 1 ||
    exactSecurityState.data[0].login_name !== credentials.data.loginName
  ) {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/login?error=credentials");
  }

  const { data: principalData, error: principalError } = await supabase.rpc(
    "current_workspace_principal",
  );
  const principal = principalPayloadSchema.safeParse(principalData);

  if (!principalError && principal.success) {
    if (principal.data.kind === "denied" || principal.data.kind === "anonymous") {
      await supabase.auth.signOut({ scope: "local" });
      redirect("/auth/denied");
    }
    if (principal.data.kind === "password_change_required") {
      redirect("/account/change-password");
    }
    const next = formData.get("next");
    if (next === "/scan/cart" || next === "/scan/equipment") redirect(next);
    redirect(primaryRoleEntryPath(principal.data.memberships.map((membership) => membership.role)));
  }

  const [securityResult, accessResult] = await Promise.all([
    supabase.rpc("current_account_security_state"),
    supabase.rpc("current_access_context"),
  ]);
  const securityState = z
    .array(z.object({ login_name: z.string(), password_change_required: z.boolean() }))
    .safeParse(securityResult.data);
  const accessContext = z
    .array(z.object({ role: accessRoleSchema }))
    .safeParse(accessResult.data);

  if (
    securityResult.error ||
    accessResult.error ||
    !securityState.success ||
    securityState.data.length !== 1 ||
    !accessContext.success ||
    accessContext.data.length === 0
  ) {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/auth/denied");
  }

  if (securityState.data[0].password_change_required) {
    redirect("/account/change-password");
  }

  const next = formData.get("next");
  if (next === "/scan/cart" || next === "/scan/equipment") redirect(next);
  redirect(primaryRoleEntryPath(accessContext.data.map((membership) => membership.role)));
}
