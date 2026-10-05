import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { z } from "zod";

import { createSupabaseAdminClient } from "../supabase/admin";
import { createServerSupabaseClient } from "../supabase/server";

import { accessRoleSchema } from "./access-role";
import { loginNameSchema } from "./account-management-schema";

export const SSO_SYSTEM_CODE = "wash" as const;
export const SSO_CALLBACK_PATH = "/api/sso-login" as const;
export const SSO_HEALTH_PATH = "/api/sso-health" as const;
export const SSO_LEGACY_HEALTH_PATH = "/login/api/sso-health" as const;
export const SSO_VERIFY_URL =
  "https://jyecltijflcplhzjoelh.supabase.co/functions/v1/verify-sso-ticket" as const;
export const SSO_BINDING_URL =
  "https://jyecltijflcplhzjoelh.supabase.co/functions/v1/complete-account-binding" as const;
export const SSO_BINDING_COOKIE_NAME = "wash_sso_binding" as const;
export const SSO_SESSION_COOKIE_NAME = "wash_sso_session" as const;
export const SSO_FLASH_COOKIE_NAME = "wash_sso_flash" as const;

const MAX_TICKET_LENGTH = 2048;
const SSO_REQUEST_TIMEOUT_MS = 8000;
const SSO_BINDING_COOKIE_MAX_AGE_SECONDS = 600;
const SSO_SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SSO_FLASH_COOKIE_MAX_AGE_SECONDS = 60;

export type SsoFlow = "login" | "account_binding";

export type SsoRequest = {
  ticket: string;
  systemCode: typeof SSO_SYSTEM_CODE;
  flow: SsoFlow;
};

export type SsoErrorCode =
  | "invalid_sso_request"
  | "invalid_sso_flow"
  | "wrong_system_code"
  | "sso_verification_failed"
  | "sso_account_not_found"
  | "sso_account_ambiguous"
  | "sso_account_ineligible"
  | "sso_configuration"
  | "sso_session_failed"
  | "sso_binding_failed";

export class SsoFlowError extends Error {
  readonly code: SsoErrorCode;

  constructor(code: SsoErrorCode) {
    super(code);
    this.name = "SsoFlowError";
    this.code = code;
  }
}

const profileSchema = z.object({
  id: z.uuid(),
  auth_user_id: z.uuid().nullable(),
  email: z.string().email(),
  login_name: loginNameSchema,
  display_name: z.string().nullable(),
  notification_email: z.string().email().nullable(),
  active: z.boolean(),
  deleted_at: z.string().nullable(),
});

const membershipSchema = z.object({
  role: accessRoleSchema,
  active: z.boolean(),
  valid_from: z.string(),
  valid_until: z.string().nullable(),
  operating_site_id: z.uuid().nullable(),
  institution_id: z.uuid().nullable(),
});

const authorizationDecisionSchema = z.array(
  z.object({
    authorized: z.boolean(),
  }),
);

const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string().email().nullable(),
  email_confirmed_at: z.string().nullable(),
});

type ProfileRow = z.infer<typeof profileSchema>;

export type LocalSsoAccount = {
  profileId: string;
  authUserId: string;
  authEmail: string;
  loginName: string;
  localEmail: string;
  localEmployeeNo: string | null;
  displayName: string;
};

type BindingState = {
  ticket: string;
  systemCode: typeof SSO_SYSTEM_CODE;
  flow: "account_binding";
  expiresAt: number;
  nonce: string;
};

type SsoSessionMarker = {
  profileId: string;
  authUserId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

type MembershipRow = z.infer<typeof membershipSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function collectParameter(
  name: string,
  searchParams: URLSearchParams,
  body: Record<string, unknown>,
  maxLength: number,
): string | undefined {
  const candidates = [
    ...searchParams.getAll(name),
    normalizedString(body[name]),
  ].filter((value): value is string => Boolean(value));
  const distinct = [...new Set(candidates.map((value) => value.trim()))];
  if (distinct.some((value) => value.length > maxLength)) {
    throw new SsoFlowError("invalid_sso_request");
  }
  if (distinct.length > 1) throw new SsoFlowError("invalid_sso_request");
  return distinct[0];
}

async function readRequestBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method !== "POST") return {};

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = await request.json();
      return isRecord(body) ? body : {};
    }
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      return Object.fromEntries(form.entries());
    }
  } catch {
    throw new SsoFlowError("invalid_sso_request");
  }
  return {};
}

function deriveSsoCookieKey(): Buffer | null {
  const configuredSecret = process.env.SSO_SESSION_SECRET?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const baseSecret = configuredSecret || serviceRoleKey;
  if (!baseSecret) return null;

  return createHash("sha256")
    .update("wash-room.sso.session.v1\0", "utf8")
    .update(baseSecret, "utf8")
    .digest();
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function bindingStatePayload(state: BindingState): string {
  return encodeBase64Url(JSON.stringify(state));
}

export function signSsoBindingState(
  state: Omit<BindingState, "nonce"> & { nonce?: string },
  secret: string,
): string {
  const payload = bindingStatePayload({
    ...state,
    nonce: state.nonce ?? randomBytes(16).toString("hex"),
  });
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySsoBindingState(
  value: string,
  secret: string,
  now = Date.now(),
): BindingState | null {
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length > 0) return null;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  const decoded = decodeBase64Url(payload);
  if (!decoded) return null;
  let decodedJson: unknown;
  try {
    decodedJson = JSON.parse(decoded);
  } catch {
    return null;
  }
  const parsed = z
    .object({
      ticket: z.string().trim().min(1).max(MAX_TICKET_LENGTH),
      systemCode: z.literal(SSO_SYSTEM_CODE),
      flow: z.literal("account_binding"),
      expiresAt: z.number().int(),
      nonce: z.string().min(16),
    })
    .safeParse(decodedJson);
  if (!parsed.success || parsed.data.expiresAt <= now) return null;
  return parsed.data;
}

export function signSsoSessionMarker(
  marker: Omit<SsoSessionMarker, "nonce"> & { nonce?: string },
  secret: string,
): string {
  const payload = encodeBase64Url(
    JSON.stringify({
      ...marker,
      nonce: marker.nonce ?? randomBytes(16).toString("hex"),
    }),
  );
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySsoSessionMarker(
  value: string,
  secret: string,
  now = Date.now(),
): SsoSessionMarker | null {
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length > 0) return null;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  const decoded = decodeBase64Url(payload);
  if (!decoded) return null;
  let decodedJson: unknown;
  try {
    decodedJson = JSON.parse(decoded);
  } catch {
    return null;
  }
  const parsed = z
    .object({
      profileId: z.uuid(),
      authUserId: z.uuid(),
      issuedAt: z.number().int(),
      expiresAt: z.number().int(),
      nonce: z.string().min(16),
    })
    .safeParse(decodedJson);
  if (!parsed.success || parsed.data.expiresAt <= now || parsed.data.issuedAt > now) {
    return null;
  }
  return parsed.data;
}

export async function readSsoSessionMarker(): Promise<SsoSessionMarker | "invalid" | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(SSO_SESSION_COOKIE_NAME)?.value;
  if (!value) return null;
  const secret = deriveSsoCookieKey();
  if (!secret) return "invalid";
  return verifySsoSessionMarker(value, secret.toString("base64url")) ?? "invalid";
}

export async function saveSsoSessionMarker(account: LocalSsoAccount): Promise<void> {
  const secret = deriveSsoCookieKey();
  if (!secret) throw new SsoFlowError("sso_configuration");
  const cookieStore = await cookies();
  const now = Date.now();
  cookieStore.set(
    SSO_SESSION_COOKIE_NAME,
    signSsoSessionMarker(
      {
        profileId: account.profileId,
        authUserId: account.authUserId,
        issuedAt: now,
        expiresAt: now + SSO_SESSION_COOKIE_MAX_AGE_SECONDS * 1000,
      },
      secret.toString("base64url"),
    ),
    {
      httpOnly: true,
      maxAge: SSO_SESSION_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );
}

export async function clearSsoSessionMarker(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SSO_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export type SsoBindingResult = "completed" | "pending_review";
export type SsoFlashKind =
  | "login"
  | "account_binding"
  | "account_binding_complete"
  | "account_binding_pending_review";

const ssoFlashMessages: Record<SsoFlashKind, string> = {
  login: "單一登入完成。",
  account_binding: "帳號綁定申請已送出。",
  account_binding_complete: "中央帳號綁定完成。",
  account_binding_pending_review: "帳號綁定申請已送出，待中央管理者覆核。",
};

function isSsoFlashKind(value: string | undefined): value is SsoFlashKind {
  return value !== undefined && Object.hasOwn(ssoFlashMessages, value);
}

export async function saveSsoFlashMessage(kind: SsoFlashKind): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SSO_FLASH_COOKIE_NAME, kind, {
    httpOnly: true,
    maxAge: SSO_FLASH_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function hasPendingSsoFlashMessage(): Promise<boolean> {
  const cookieStore = await cookies();
  return isSsoFlashKind(cookieStore.get(SSO_FLASH_COOKIE_NAME)?.value);
}

export async function consumeSsoFlashMessage(): Promise<string | null> {
  const cookieStore = await cookies();
  const kind = cookieStore.get(SSO_FLASH_COOKIE_NAME)?.value;
  const message = isSsoFlashKind(kind) ? ssoFlashMessages[kind] : null;
  cookieStore.set(SSO_FLASH_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return message;
}

async function readPendingBindingState(): Promise<BindingState | null> {
  const secret = deriveSsoCookieKey();
  if (!secret) return null;
  const cookieStore = await cookies();
  const value = cookieStore.get(SSO_BINDING_COOKIE_NAME)?.value;
  if (!value) return null;
  return verifySsoBindingState(value, secret.toString("base64url"));
}

export async function savePendingSsoBinding(ticket: string): Promise<void> {
  const secret = deriveSsoCookieKey();
  if (!secret) throw new SsoFlowError("sso_configuration");
  const cookieStore = await cookies();
  cookieStore.set(
    SSO_BINDING_COOKIE_NAME,
    signSsoBindingState(
      {
        ticket,
        systemCode: SSO_SYSTEM_CODE,
        flow: "account_binding",
        expiresAt: Date.now() + SSO_BINDING_COOKIE_MAX_AGE_SECONDS * 1000,
      },
      secret.toString("base64url"),
    ),
    {
      httpOnly: true,
      maxAge: SSO_BINDING_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  );
}

export async function clearPendingSsoBinding(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SSO_BINDING_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function resolveSsoFlow(
  requestedFlow: string | undefined,
  pendingFlow: SsoFlow | undefined,
): SsoFlow {
  if (pendingFlow && requestedFlow && requestedFlow !== pendingFlow) {
    throw new SsoFlowError("invalid_sso_flow");
  }
  const flow = requestedFlow ?? pendingFlow ?? "login";
  if (flow !== "login" && flow !== "account_binding") {
    throw new SsoFlowError("invalid_sso_flow");
  }
  return flow;
}

export async function parseSsoRequest(request: Request): Promise<SsoRequest> {
  const url = new URL(request.url);
  const body = await readRequestBody(request);
  const pending = await readPendingBindingState();
  const providedTicket = collectParameter(
    "sso_ticket",
    url.searchParams,
    body,
    MAX_TICKET_LENGTH,
  );
  const providedSystemCode = collectParameter("system_code", url.searchParams, body, 64);
  const requestedFlow = collectParameter("sso_flow", url.searchParams, body, 64);
  const flow = resolveSsoFlow(requestedFlow, pending?.flow);

  if (
    pending &&
    ((providedTicket && providedTicket !== pending.ticket) ||
      (providedSystemCode && providedSystemCode !== pending.systemCode))
  ) {
    throw new SsoFlowError("invalid_sso_request");
  }

  const ticket = providedTicket ?? pending?.ticket;
  const systemCode = providedSystemCode ?? pending?.systemCode;

  if (!ticket || !systemCode) throw new SsoFlowError("invalid_sso_request");
  if (systemCode !== SSO_SYSTEM_CODE) throw new SsoFlowError("wrong_system_code");

  return { ticket, systemCode: SSO_SYSTEM_CODE, flow };
}

function extractIdentityValue(
  records: Record<string, unknown>[],
  keys: string[],
): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = normalizedString(record[key]);
      if (value) return value;
    }
  }
  return undefined;
}

export type CentralSsoIdentity = {
  localUserId?: string;
  email?: string;
};

export function parseAcceptedCentralSsoResponse(
  status: number,
  payload: unknown,
): CentralSsoIdentity | null {
  if (status !== 200 || !isRecord(payload) || payload.ok !== true) return null;

  const nested = [payload.data, payload.user].filter(isRecord);
  const records = [payload, ...nested];
  const rawLocalUserId = extractIdentityValue(records, [
    "localUserId",
    "local_user_id",
    "profileId",
    "profile_id",
    "id",
  ]);
  const rawEmail = extractIdentityValue(records, ["email", "localEmail", "local_email"]);
  const localUserId = rawLocalUserId && z.uuid().safeParse(rawLocalUserId).success
    ? rawLocalUserId
    : undefined;
  const email = rawEmail?.toLowerCase();
  if (!localUserId && !email) return null;
  return { localUserId, email };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function verifyCentralSsoTicket(
  ticket: string,
  systemCode: typeof SSO_SYSTEM_CODE,
  fetchImplementation: typeof fetch = fetch,
): Promise<CentralSsoIdentity> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SSO_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(SSO_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, systemCode }),
      signal: controller.signal,
    });
    const identity = parseAcceptedCentralSsoResponse(
      response.status,
      await readJsonResponse(response),
    );
    if (!identity) throw new SsoFlowError("sso_verification_failed");
    return identity;
  } catch (error) {
    if (error instanceof SsoFlowError) throw error;
    throw new SsoFlowError("sso_verification_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function queryProfilesById(profileId: string): Promise<ProfileRow[]> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new SsoFlowError("sso_configuration");
  const { data, error } = await admin
    .from("user_access_profiles")
    .select("id, auth_user_id, email, login_name, display_name, notification_email, active, deleted_at")
    .eq("id", profileId);
  if (error) throw new SsoFlowError("sso_account_not_found");
  const parsed = z.array(profileSchema).safeParse(data);
  if (!parsed.success) throw new SsoFlowError("sso_account_not_found");
  return parsed.data;
}

async function queryProfilesByEmail(email: string): Promise<ProfileRow[]> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new SsoFlowError("sso_configuration");
  const [internalEmailResult, notificationEmailResult] = await Promise.all([
    admin
      .from("user_access_profiles")
      .select("id, auth_user_id, email, login_name, display_name, notification_email, active, deleted_at")
      .eq("email", email),
    admin
      .from("user_access_profiles")
      .select("id, auth_user_id, email, login_name, display_name, notification_email, active, deleted_at")
      .eq("notification_email", email),
  ]);
  if (internalEmailResult.error || notificationEmailResult.error) {
    throw new SsoFlowError("sso_account_not_found");
  }
  const parsed = z.array(profileSchema).safeParse([
    ...(internalEmailResult.data ?? []),
    ...(notificationEmailResult.data ?? []),
  ]);
  if (!parsed.success) throw new SsoFlowError("sso_account_not_found");
  return parsed.data;
}

async function assertEligibleProfile(profile: ProfileRow): Promise<LocalSsoAccount> {
  if (!profile.active || profile.deleted_at || !profile.auth_user_id) {
    throw new SsoFlowError("sso_account_ineligible");
  }

  const admin = createSupabaseAdminClient();
  if (!admin) throw new SsoFlowError("sso_configuration");
  const { data, error } = await admin
    .from("access_memberships")
    .select("role, active, valid_from, valid_until, operating_site_id, institution_id")
    .eq("user_access_profile_id", profile.id);
  if (error) throw new SsoFlowError("sso_account_ineligible");
  const memberships = z.array(membershipSchema).safeParse(data);
  if (!memberships.success) throw new SsoFlowError("sso_account_ineligible");

  const membershipSiteIds = [
    ...new Set(
      memberships.data
        .map((membership) => membership.operating_site_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const institutionIds = [
    ...new Set(
      memberships.data
        .map((membership) => membership.institution_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const institutionResult = institutionIds.length
    ? await admin
        .from("institutions")
        .select("id, active, operating_site_id")
        .in("id", institutionIds)
    : { data: [], error: null };
  if (institutionResult.error) {
    throw new SsoFlowError("sso_account_ineligible");
  }

  const siteIds = [
    ...new Set([
      ...membershipSiteIds,
      ...(institutionResult.data ?? []).map((institution) => institution.operating_site_id),
    ]),
  ];
  const siteResult = siteIds.length
    ? await admin.from("operating_sites").select("id, active").in("id", siteIds)
    : { data: [], error: null };
  if (siteResult.error) throw new SsoFlowError("sso_account_ineligible");

  const activeSiteIds = new Set(
    (siteResult.data ?? [])
      .filter((site) => site.active)
      .map((site) => site.id),
  );
  const activeInstitutionIds = new Set(
    (institutionResult.data ?? [])
      .filter(
        (institution) =>
          institution.active && activeSiteIds.has(institution.operating_site_id),
      )
      .map((institution) => institution.id),
  );

  const hasValidMembership = hasEligibleSsoMembership(
    memberships.data,
    activeSiteIds,
    activeInstitutionIds,
  );
  if (!hasValidMembership) throw new SsoFlowError("sso_account_ineligible");

  return {
    profileId: profile.id,
    authUserId: profile.auth_user_id,
    authEmail: profile.email,
    loginName: profile.login_name,
    localEmail: profile.notification_email ?? profile.email,
    // The current wash-room profile schema has no employee_no field.
    localEmployeeNo: null,
    displayName: profile.display_name ?? profile.login_name,
  };
}

export function hasEligibleSsoMembership(
  memberships: MembershipRow[],
  activeSiteIds: ReadonlySet<string>,
  activeInstitutionIds: ReadonlySet<string>,
  now = Date.now(),
): boolean {
  return memberships.some((membership) => {
    const starts = Date.parse(membership.valid_from);
    const ends = membership.valid_until
      ? Date.parse(membership.valid_until)
      : Number.POSITIVE_INFINITY;
    const hasActiveScope =
      membership.role === "institution_supervisor"
        ? Boolean(
            membership.institution_id &&
              activeInstitutionIds.has(membership.institution_id),
          )
        : Boolean(
            membership.operating_site_id &&
              activeSiteIds.has(membership.operating_site_id),
          );
    return membership.active && hasActiveScope && starts <= now && now < ends;
  });
}

export async function resolveLocalSsoAccount(
  identity: CentralSsoIdentity,
): Promise<LocalSsoAccount> {
  const profiles = identity.localUserId
    ? await queryProfilesById(identity.localUserId)
    : identity.email
      ? await queryProfilesByEmail(identity.email)
      : [];
  const uniqueProfiles = [...new Map(profiles.map((profile) => [profile.id, profile])).values()];
  if (uniqueProfiles.length === 0) throw new SsoFlowError("sso_account_not_found");
  if (uniqueProfiles.length > 1) throw new SsoFlowError("sso_account_ambiguous");
  return assertEligibleProfile(uniqueProfiles[0]);
}

async function assertAuthIdentity(account: LocalSsoAccount) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new SsoFlowError("sso_configuration");
  const { data, error } = await admin.auth.admin.getUserById(account.authUserId);
  const parsed = authUserSchema.safeParse(data?.user);
  if (
    error ||
    !parsed.success ||
    parsed.data.id !== account.authUserId ||
    parsed.data.email?.toLowerCase() !== account.authEmail ||
    !parsed.data.email_confirmed_at
  ) {
    throw new SsoFlowError("sso_account_ineligible");
  }
  return parsed.data;
}

export async function createTargetSsoSession(account: LocalSsoAccount) {
  await assertAuthIdentity(account);
  const admin = createSupabaseAdminClient();
  if (!admin) throw new SsoFlowError("sso_configuration");
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: account.authEmail,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (
    linkError ||
    !tokenHash ||
    !linkData.user ||
    linkData.user.id !== account.authUserId
  ) {
    throw new SsoFlowError("sso_session_failed");
  }

  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (otpError || !otpData.session || otpData.user?.id !== account.authUserId) {
    await supabase.auth.signOut({ scope: "local" });
    throw new SsoFlowError("sso_session_failed");
  }

  const { data: authorizationData, error: authorizationError } = await supabase.rpc(
    "authorize_current_user",
  );
  const authorization = authorizationDecisionSchema.safeParse(authorizationData);
  if (
    authorizationError ||
    !authorization.success ||
    authorization.data.length !== 1 ||
    !authorization.data[0].authorized
  ) {
    await supabase.auth.signOut({ scope: "local" });
    throw new SsoFlowError("sso_account_ineligible");
  }

  return supabase;
}

async function getCurrentAuthUser() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

export async function resolveCurrentTargetSsoAccount(): Promise<{
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  account: LocalSsoAccount;
} | null> {
  const current = await getCurrentAuthUser();
  if (!current) return null;
  const admin = createSupabaseAdminClient();
  if (!admin) throw new SsoFlowError("sso_configuration");
  const { data, error } = await admin
    .from("user_access_profiles")
    .select("id, auth_user_id, email, login_name, display_name, notification_email, active, deleted_at")
    .eq("auth_user_id", current.user.id);
  if (error) throw new SsoFlowError("sso_account_not_found");
  const profiles = z.array(profileSchema).safeParse(data);
  if (!profiles.success || profiles.data.length !== 1) {
    throw new SsoFlowError(
      profiles.success && profiles.data.length > 1
        ? "sso_account_ambiguous"
        : "sso_account_not_found",
    );
  }
  return { supabase: current.supabase, account: await assertEligibleProfile(profiles.data[0]) };
}

function parseCentralSsoBindingResult(payload: unknown): SsoBindingResult | null {
  if (!isRecord(payload)) return null;
  if (payload.pending_review === true) return "pending_review";
  if (payload.ok === true) return "completed";
  return null;
}

export async function completeCentralSsoBinding(
  ticket: string,
  account: LocalSsoAccount,
  fetchImplementation: typeof fetch = fetch,
): Promise<SsoBindingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SSO_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(SSO_BINDING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticket,
        systemCode: SSO_SYSTEM_CODE,
        localUserId: account.profileId,
        localLogin: account.loginName,
        localEmail: account.localEmail,
        localEmployeeNo: account.localEmployeeNo,
        displayName: account.displayName,
        localActive: true,
      }),
      signal: controller.signal,
    });
    const result = response.status === 200
      ? parseCentralSsoBindingResult(await readJsonResponse(response))
      : null;
    if (!result) {
      throw new SsoFlowError("sso_binding_failed");
    }
    return result;
  } catch (error) {
    if (error instanceof SsoFlowError) throw error;
    throw new SsoFlowError("sso_binding_failed");
  } finally {
    clearTimeout(timeout);
  }
}
