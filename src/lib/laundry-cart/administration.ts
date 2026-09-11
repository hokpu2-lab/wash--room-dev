import "server-only";

import { z } from "zod";

import { isLaundrySupervisorRole } from "@/lib/auth/access-role";
import { requireRole } from "@/lib/auth/principal";
import { resolveWorkspaceScope } from "@/lib/auth/workspace-scope";
import { renderFixedAssetQrSvg } from "@/lib/fixed-asset-qr";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const laundryCartWorkspaceSchema = z.object({
  institutions: z.array(
    z.object({
      id: z.uuid(),
      code: z.string().min(1),
      name: z.string().min(1),
      operating_site_id: z.uuid(),
      operating_sites: z.object({
        code: z.string().min(1),
        name: z.string().min(1),
      }),
    }),
  ),
  carts: z.array(
    z.object({
      id: z.uuid(),
      cart_number: z.string().min(1),
      institution_id: z.uuid(),
      active: z.boolean(),
      current_qr_version: z.number().int().positive(),
      institutions: z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        operating_sites: z.object({
          code: z.string().min(1),
          name: z.string().min(1),
        }),
      }),
    }),
  ),
});

const registerLaundryCartInputSchema = z.object({
  cartNumber: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  institutionCode: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

const setLaundryCartActiveInputSchema = z.object({
  cartId: z.uuid(),
  active: z.boolean(),
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

const reissueLaundryCartQrInputSchema = z.object({
  cartId: z.uuid(),
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  confirmed: z.literal(true),
});

const laundryCartChangeResultSchema = z.array(
  z.object({
    laundry_cart_id: z.uuid().nullable(),
    qr_version: z.number().int().positive().nullable(),
    already_applied: z.boolean(),
    outcome: z.enum(["applied", "denied"]),
  }),
);

const currentLaundryCartQrSchema = z.array(
  z.object({
    laundry_cart_id: z.uuid(),
    cart_number: z.string().min(1).max(40),
    qr_version: z.number().int().positive(),
    qr_token: z
      .string()
      .regex(/^wrq_v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/),
  }),
);

export type LaundryCartWorkspace = z.infer<typeof laundryCartWorkspaceSchema>;

export type RegisterLaundryCartResult =
  | { kind: "applied" | "already-applied"; cartId: string; cartNumber: string }
  | { kind: "invalid" | "failed" | "denied" };

export type SetLaundryCartActiveResult =
  | {
      kind: "applied" | "already-applied";
      cartId: string;
      active: boolean;
    }
  | { kind: "invalid" | "failed" | "denied" };

export type ReissueLaundryCartQrResult =
  | {
      kind: "applied" | "already-applied";
      cartId: string;
      qrVersion: number;
    }
  | { kind: "invalid" | "failed" | "denied" };

export type LaundryCartQrCard = {
  id: string;
  cartNumber: string;
  institutionCode: string;
  institutionName: string;
  siteCode: string;
  siteName: string;
  active: boolean;
  qrVersion: number;
};

export async function getLaundryCartWorkspace(): Promise<LaundryCartWorkspace> {
  const principal = await requireRole("laundry_supervisor");
  const scope = await resolveWorkspaceScope();
  const allSiteIds = principal.memberships
    .filter((membership) => isLaundrySupervisorRole(membership.role))
    .map((membership) => membership.operating_site_id)
    .filter((siteId): siteId is string => siteId !== null);
  const supervisorSiteIds = scope.siteId && allSiteIds.includes(scope.siteId) ? [scope.siteId] : allSiteIds;
  const supabase = await createServerSupabaseClient();
  const [institutionsResult, cartsResult] = await Promise.all([
    supabase
      .from("institutions")
      .select(
        "id, code, name, operating_site_id, operating_sites!inner(code, name)",
      )
      .eq("active", true)
      .in("operating_site_id", supervisorSiteIds)
      .order("code", { ascending: true }),
    supabase
      .from("laundry_carts")
      .select(
        "id, cart_number, institution_id, active, current_qr_version, institutions!inner(code, name, operating_sites!inner(code, name))",
      )
      .order("cart_number", { ascending: true }),
  ]);
  const workspace = laundryCartWorkspaceSchema.safeParse({
    institutions: institutionsResult.data,
    carts: cartsResult.data,
  });

  if (institutionsResult.error || cartsResult.error || !workspace.success) {
    return { institutions: [], carts: [] };
  }

  const institutionIds = new Set(workspace.data.institutions.map((institution) => institution.id));
  return {
    institutions: workspace.data.institutions,
    carts: workspace.data.carts.filter((cart) => institutionIds.has(cart.institution_id)),
  };
}

export async function registerLaundryCart(
  input: unknown,
): Promise<RegisterLaundryCartResult> {
  await requireRole("laundry_supervisor");
  const parsedInput = registerLaundryCartInputSchema.safeParse(input);

  if (!parsedInput.success) return { kind: "invalid" };

  const cartNumber = parsedInput.data.cartNumber.toUpperCase();
  const supabase = await createServerSupabaseClient({
    cookieWritesRequired: true,
  });
  const { data, error } = await supabase.rpc("register_laundry_cart", {
    requested_cart_number: cartNumber,
    target_institution_code: parsedInput.data.institutionCode.toUpperCase(),
    change_request_id: parsedInput.data.requestId,
    change_reason: parsedInput.data.reason,
  });
  const result = laundryCartChangeResultSchema.safeParse(data);

  if (error || !result.success || result.data.length !== 1) {
    return { kind: "failed" };
  }

  const change = result.data[0];
  if (change.outcome === "denied") return { kind: "denied" };
  if (!change.laundry_cart_id || change.qr_version === null) {
    return { kind: "failed" };
  }

  return {
    kind: change.already_applied ? "already-applied" : "applied",
    cartId: change.laundry_cart_id,
    cartNumber,
  };
}

export async function setLaundryCartActive(
  input: unknown,
): Promise<SetLaundryCartActiveResult> {
  await requireRole("laundry_supervisor");
  const parsedInput = setLaundryCartActiveInputSchema.safeParse(input);

  if (!parsedInput.success) return { kind: "invalid" };

  const supabase = await createServerSupabaseClient({
    cookieWritesRequired: true,
  });
  const { data, error } = await supabase.rpc("set_laundry_cart_active", {
    target_laundry_cart_id: parsedInput.data.cartId,
    target_active: parsedInput.data.active,
    change_request_id: parsedInput.data.requestId,
    change_reason: parsedInput.data.reason,
  });
  const result = laundryCartChangeResultSchema.safeParse(data);

  if (error || !result.success || result.data.length !== 1) {
    return { kind: "failed" };
  }

  const change = result.data[0];
  if (change.outcome === "denied") return { kind: "denied" };
  if (!change.laundry_cart_id || change.qr_version === null) {
    return { kind: "failed" };
  }

  return {
    kind: change.already_applied ? "already-applied" : "applied",
    cartId: change.laundry_cart_id,
    active: parsedInput.data.active,
  };
}

export async function getLaundryCartQrCard(
  cartId: unknown,
): Promise<LaundryCartQrCard | null> {
  const parsedCartId = z.uuid().safeParse(cartId);
  if (!parsedCartId.success) return null;

  const workspace = await getLaundryCartWorkspace();
  const cart = workspace.carts.find(
    (candidate) => candidate.id === parsedCartId.data,
  );
  if (!cart) return null;

  return {
    id: cart.id,
    cartNumber: cart.cart_number,
    institutionCode: cart.institutions.code,
    institutionName: cart.institutions.name,
    siteCode: cart.institutions.operating_sites.code,
    siteName: cart.institutions.operating_sites.name,
    active: cart.active,
    qrVersion: cart.current_qr_version,
  };
}

export async function renderLaundryCartQrSvg(
  cartId: unknown,
): Promise<{ svg: string; cartNumber: string; qrVersion: number } | null> {
  await requireRole("laundry_supervisor");
  const parsedCartId = z.uuid().safeParse(cartId);
  if (!parsedCartId.success) return null;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_current_laundry_cart_qr", {
    target_laundry_cart_id: parsedCartId.data,
  });
  const result = currentLaundryCartQrSchema.safeParse(data);

  if (
    error ||
    !result.success ||
    result.data.length !== 1 ||
    result.data[0].laundry_cart_id !== parsedCartId.data
  ) {
    return null;
  }

  const credential = result.data[0];
  return {
    svg: renderFixedAssetQrSvg({
      scanPath: "/scan/cart",
      fragmentCredential: credential.qr_token,
      label: credential.cart_number,
    }),
    cartNumber: credential.cart_number,
    qrVersion: credential.qr_version,
  };
}

export async function reissueLaundryCartQr(
  input: unknown,
): Promise<ReissueLaundryCartQrResult> {
  await requireRole("laundry_supervisor");
  const parsedInput = reissueLaundryCartQrInputSchema.safeParse(input);

  if (!parsedInput.success) return { kind: "invalid" };

  const supabase = await createServerSupabaseClient({
    cookieWritesRequired: true,
  });
  const { data, error } = await supabase.rpc("reissue_laundry_cart_qr", {
    target_laundry_cart_id: parsedInput.data.cartId,
    change_request_id: parsedInput.data.requestId,
    change_reason: parsedInput.data.reason,
  });
  const result = laundryCartChangeResultSchema.safeParse(data);

  if (error || !result.success || result.data.length !== 1) {
    return { kind: "failed" };
  }

  const change = result.data[0];
  if (change.outcome === "denied") return { kind: "denied" };
  if (!change.laundry_cart_id || change.qr_version === null) {
    return { kind: "failed" };
  }

  return {
    kind: change.already_applied ? "already-applied" : "applied",
    cartId: change.laundry_cart_id,
    qrVersion: change.qr_version,
  };
}
