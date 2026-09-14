import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  accessRoleSchema,
  isLaundrySupervisorRole,
  primaryRole,
  roleEntryPath,
  type AccessRole,
} from "./access-role";
import { resolveWorkspaceScope, withWorkspaceScope } from "./workspace-scope";

const membershipSchema = z.object({
  membership_id: z.uuid(),
  role: accessRoleSchema,
  operating_site_id: z.uuid().nullable(),
  institution_id: z.uuid().nullable(),
  scope_code: z.string().min(1),
  scope_name: z.string().min(1),
});

export type PrincipalMembership = z.infer<typeof membershipSchema>;
export type AccessMembership = PrincipalMembership;

export type PrincipalState =
  | { kind: "anonymous" }
  | { kind: "denied" }
  | { kind: "password_change_required" }
  | { kind: "authorized"; principal: Principal };

const principalPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anonymous") }),
  z.object({ kind: z.literal("denied") }),
  z.object({
    kind: z.literal("password_change_required"),
    login_name: z.string().optional(),
  }),
  z.object({
    kind: z.literal("authorized"),
    login_name: z.string().optional(),
    memberships: z.array(membershipSchema).min(1),
  }),
]);

const accessContextSchema = z.array(membershipSchema).min(1);

export type Principal = {
  loginName?: string;
  memberships: AccessMembership[];
};

async function hasAuthenticatedSession() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  return !error && Boolean(data.session);
}

async function resolvePrincipalFromLegacyRpcs(): Promise<PrincipalState> {
  const supabase = await createServerSupabaseClient();
  const [authorizationResult, securityState, accessResult] = await Promise.all([
    supabase.rpc("authorize_current_user"),
    supabase.rpc("current_account_security_state"),
    supabase.rpc("current_access_context"),
  ]);

  if (authorizationResult.error || !authorizationResult.data?.authorized) {
    return { kind: "denied" };
  }
  if (securityState.error || !securityState.data?.[0]) {
    return { kind: "denied" };
  }
  if (securityState.data[0].password_change_required) {
    return { kind: "password_change_required" };
  }

  const parsedAccess = accessContextSchema.safeParse(accessResult.data);
  if (accessResult.error || !parsedAccess.success) {
    return { kind: "denied" };
  }
  return {
    kind: "authorized",
    principal: {
      loginName: securityState.data[0].login_name,
      memberships: parsedAccess.data,
    },
  };
}

export const getPrincipalState = cache(async (): Promise<PrincipalState> => {
  if (!(await hasAuthenticatedSession())) {
    return { kind: "anonymous" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("current_workspace_principal");
  const parsed = principalPayloadSchema.safeParse(data);
  if (!error && parsed.success) {
    if (parsed.data.kind === "authorized") {
      return {
        kind: "authorized",
        principal: {
          loginName: parsed.data.login_name,
          memberships: parsed.data.memberships,
        },
      };
    }
    return parsed.data;
  }

  return resolvePrincipalFromLegacyRpcs();
});

export async function requirePrincipal(): Promise<Principal> {
  const state = await getPrincipalState();

  if (state.kind === "anonymous") {
    redirect("/login");
  }

  if (state.kind === "denied") {
    redirect("/auth/denied");
  }

  if (state.kind === "password_change_required") {
    redirect("/account/change-password");
  }

  return state.principal;
}

function principalSatisfiesRole(principal: Principal, role: AccessRole): boolean {
  return principal.memberships.some((membership) => {
    if (membership.role === "system_administrator") return true;
    if (membership.role === role) return true;
    if (role === "laundry_supervisor" && isLaundrySupervisorRole(membership.role)) return true;
    return false;
  });
}

function principalSatisfiesAnyRole(principal: Principal, roles: AccessRole[]): boolean {
  return roles.some((role) => principalSatisfiesRole(principal, role));
}

async function redirectToOwnWorkspace(principal: Principal): Promise<never> {
  const roles = principal.memberships.map((m) => m.role);
  const bestRole = primaryRole(roles);
  const fallback = principal.memberships.find((m) => m.role === bestRole) ?? principal.memberships[0];
  const scope = await resolveWorkspaceScope();
  redirect(withWorkspaceScope(roleEntryPath(fallback.role), scope));
}

export async function requireRole(role: AccessRole): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!principalSatisfiesRole(principal, role)) {
    await redirectToOwnWorkspace(principal);
  }
  return principal;
}

export async function requireAnyRole(roles: AccessRole[]): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!principalSatisfiesAnyRole(principal, roles)) {
    await redirectToOwnWorkspace(principal);
  }
  return principal;
}
