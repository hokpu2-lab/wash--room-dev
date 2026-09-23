import "server-only";

import { z } from "zod";

import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole } from "@/lib/auth/principal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const organizationWorkspaceSchema = z.object({
  sites: z.array(
    z.object({
      id: z.uuid(),
      code: z.string().min(1),
      name: z.string().min(1),
      active: z.boolean(),
    }),
  ),
  institutions: z.array(
    z.object({
      id: z.uuid(),
      code: z.string().min(1),
      name: z.string().min(1),
      active: z.boolean(),
      operating_site_id: z.uuid(),
      operating_sites: z.object({
        code: z.string().min(1),
        name: z.string().min(1),
      }),
      cartNumbers: z.array(z.string()).default([]),
    }),
  ),
});

const institutionChangeInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  name: z.string().trim().min(1).max(120),
  siteCode: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  active: z.boolean(),
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

const institutionChangeResultSchema = z.array(
  z.object({
    institution_id: z.uuid(),
    already_applied: z.boolean(),
  }),
);

export type OrganizationWorkspace = z.infer<typeof organizationWorkspaceSchema>;

export type InstitutionChangeResult =
  | { kind: "applied"; institutionId: string; code: string }
  | { kind: "already-applied"; institutionId: string; code: string }
  | { kind: "invalid" }
  | { kind: "failed" };

export async function getOrganizationWorkspace(): Promise<OrganizationWorkspace> {
  const principal = await requireRole("laundry_supervisor");
  const supervisorSiteIds = principal.memberships
    .filter((membership) => isLaundrySupervisorRole(membership.role))
    .map((membership) => membership.operating_site_id)
    .filter((siteId): siteId is string => siteId !== null);
  const supabase = await createServerSupabaseClient();
  const [sitesResult, institutionsResult, cartsResult] = await Promise.all([
    supabase
      .from("operating_sites")
      .select("id, code, name, active")
      .in("id", supervisorSiteIds)
      .order("code", { ascending: true }),
    supabase
      .from("institutions")
      .select(
        "id, code, name, active, operating_site_id, operating_sites!inner(code, name)",
      )
      .in("operating_site_id", supervisorSiteIds)
      .order("code", { ascending: true }),
    supabase
      .from("laundry_carts")
      .select("id, cart_number, institution_id, active")
      .order("cart_number", { ascending: true }),
  ]);

  const cartsByInstitution = new Map<string, string[]>();
  if (cartsResult.data) {
    for (const cart of cartsResult.data) {
      const list = cartsByInstitution.get(cart.institution_id) ?? [];
      list.push(cart.cart_number);
      cartsByInstitution.set(cart.institution_id, list);
    }
  }

  const enrichedInstitutions = institutionsResult.data?.map((inst) => ({
    ...inst,
    cartNumbers: cartsByInstitution.get(inst.id) ?? [],
  }));

  const workspace = organizationWorkspaceSchema.safeParse({
    sites: sitesResult.data,
    institutions: enrichedInstitutions,
  });

  if (sitesResult.error || institutionsResult.error || !workspace.success) {
    throw new Error("organization workspace unavailable");
  }

  return workspace.data;
}

export async function applyInstitutionChange(
  input: unknown,
): Promise<InstitutionChangeResult> {
  await requireRole("laundry_supervisor");
  const parsedInput = institutionChangeInputSchema.safeParse(input);

  if (!parsedInput.success) return { kind: "invalid" };

  const normalizedCode = parsedInput.data.code.toUpperCase();
  const normalizedSiteCode = parsedInput.data.siteCode.toUpperCase();
  const supabase = await createServerSupabaseClient({
    cookieWritesRequired: true,
  });
  const { data, error } = await supabase.rpc("apply_institution_change", {
    institution_code: normalizedCode,
    institution_name: parsedInput.data.name,
    target_site_code: normalizedSiteCode,
    institution_active: parsedInput.data.active,
    change_request_id: parsedInput.data.requestId,
    change_reason: parsedInput.data.reason,
  });
  const result = institutionChangeResultSchema.safeParse(data);

  if (error || !result.success || result.data.length !== 1) {
    return { kind: "failed" };
  }

  return {
    kind: result.data[0].already_applied ? "already-applied" : "applied",
    institutionId: result.data[0].institution_id,
    code: normalizedCode,
  };
}
