"use server";

import { parse } from "csv-parse/sync";
import { redirect } from "next/navigation";
import { z } from "zod";

import { accessRoleSchema, isSiteRole } from "@/lib/auth/access-role";
import {
  accountMembershipInputSchema,
  internalAuthEmail,
  loginNameSchema,
  temporaryPasswordSchema,
} from "@/lib/auth/account-management-schema";
import { getManagedAccount, listManagedAccounts } from "@/lib/auth/account-management";
import { requireRole } from "@/lib/auth/principal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const changeReasonSchema = z.string().trim().min(1).max(500);
const profileIdSchema = z.uuid();
const manageResultSchema = z.array(
  z.object({
    user_access_profile_id: z.uuid(),
    internal_auth_email: z.email(),
    created_account: z.boolean(),
    already_applied: z.boolean(),
  }),
);
const identitySchema = z.array(
  z.object({ auth_user_id: z.uuid(), auth_email: z.email() }),
);
const batchPermissionResultSchema = z.array(
  z.object({ applied_count: z.number().int().nonnegative(), already_applied: z.boolean() }),
);
const batchPermissionCsvHeaders = [
  "login_name",
  "role",
  "site_code",
  "institution_code",
  "account_active",
  "membership_active",
] as const;
const batchPermissionRowSchema = z
  .object({
    login_name: loginNameSchema,
    role: accessRoleSchema,
    site_code: z.string().min(1).nullable(),
    institution_code: z.string().min(1).nullable(),
    account_active: z.boolean(),
    membership_active: z.boolean(),
  })
  .superRefine((row, context) => {
    const siteRole = isSiteRole(row.role);
    const valid = siteRole
      ? row.site_code !== null && row.institution_code === null
      : row.site_code === null && row.institution_code !== null;
    if (!valid) context.addIssue({ code: "custom", message: "角色與權限範圍不一致" });
  });

function textValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalCode(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function parseBoolean(value: string) {
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  throw new Error("CSV boolean must be true or false");
}

function accountRedirect(status: string, tab: string, profileId?: string): never {
  const query = new URLSearchParams({ status });
  if (profileId) query.set("account", profileId);
  redirect(`/app/admin/accounts?${query.toString()}#tab=${tab}`);
}

function parseMemberships(formData: FormData) {
  const parsed = formData.getAll("permissions").map((value) => {
    if (typeof value !== "string") return null;
    const [role, scopeType, code, extra] = value.split("|");
    if (extra || !code) return null;
    return accountMembershipInputSchema.safeParse({
      role,
      site_code: scopeType === "site" ? code : null,
      institution_code: scopeType === "institution" ? code : null,
    });
  });
  if (parsed.length === 0 || parsed.some((item) => !item?.success)) return null;
  return parsed.map((item) => item!.data);
}

function parseAccountForm(formData: FormData, includePassword: boolean) {
  const loginName = loginNameSchema.safeParse(textValue(formData.get("login_name")));
  const reason = changeReasonSchema.safeParse(textValue(formData.get("change_reason")));
  const memberships = parseMemberships(formData);
  const notificationEmailValue = textValue(formData.get("notification_email"));
  const notificationEmail = notificationEmailValue
    ? z.email().safeParse(notificationEmailValue.toLowerCase())
    : { success: true as const, data: "" };
  const displayName = textValue(formData.get("display_name"));
  const password = includePassword
    ? temporaryPasswordSchema.safeParse(textValue(formData.get("temporary_password")))
    : { success: true as const, data: "" };
  const confirmation = textValue(formData.get("password_confirmation"));

  if (!loginName.success) return { success: false as const, status: "invalid-login-name" };
  if (displayName.length > 80) return { success: false as const, status: "invalid-display-name" };
  if (!notificationEmail.success) return { success: false as const, status: "invalid-notification-email" };
  if (!memberships) return { success: false as const, status: "invalid-permissions" };
  if (!password.success) return { success: false as const, status: "invalid-temporary-password" };
  if (includePassword && password.data !== confirmation) {
    return { success: false as const, status: "password-confirmation-mismatch" };
  }
  if (!reason.success) return { success: false as const, status: "invalid-change-reason" };

  return {
    success: true as const,
    data: {
      loginName: loginName.data,
      displayName,
      notificationEmail: notificationEmail.data,
      reason: reason.data,
      memberships,
      password: password.data,
    },
  };
}

async function getAuthIdentity(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  profileId: string,
) {
  const { data, error } = await admin.rpc("internal_get_managed_auth_identity", {
    target_profile_id: profileId,
  });
  const parsed = identitySchema.safeParse(data);
  return error || !parsed.success ? null : parsed.data[0] ?? null;
}

export async function createManagedAccount(formData: FormData) {
  await requireRole("laundry_supervisor");
  const parsedForm = parseAccountForm(formData, true);
  const requestId = z.uuid().safeParse(textValue(formData.get("change_request_id")));
  if (!parsedForm.success) accountRedirect(parsedForm.status, "create");
  const parsed = parsedForm.data;
  if (!requestId.success) accountRedirect("invalid-request-id", "create");
  const admin = createSupabaseAdminClient();
  if (!admin) accountRedirect("auth-admin-unavailable", "create");

  const authEmail = internalAuthEmail(parsed.loginName);
  const { data: createdIdentity, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password: parsed.password,
    email_confirm: true,
    user_metadata: { login_name: parsed.loginName, display_name: parsed.displayName || null },
  });
  if (createError || !createdIdentity.user) accountRedirect("auth-create-failed", "create");

  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("manage_user_account", {
    target_profile_id: null,
    requested_login_name: parsed.loginName,
    requested_display_name: parsed.displayName || null,
    requested_notification_email: parsed.notificationEmail || null,
    requested_account_active: true,
    requested_memberships: parsed.memberships,
    change_request_id: requestId.data,
    change_reason: parsed.reason,
  });
  const result = manageResultSchema.safeParse(data);
  if (error || !result.success || result.data.length !== 1 || !result.data[0]) {
    await admin.auth.admin.deleteUser(createdIdentity.user.id);
    accountRedirect("create-failed", "create");
  }

  const profileId = result.data[0].user_access_profile_id;
  const { error: bindError } = await admin.rpc("internal_bind_managed_auth_identity", {
    target_profile_id: profileId,
    target_auth_user_id: createdIdentity.user.id,
  });
  if (bindError) {
    await admin.auth.admin.deleteUser(createdIdentity.user.id);
    await supabase.rpc("retire_managed_user_account", {
      target_profile_id: profileId,
      change_request_id: crypto.randomUUID(),
      change_reason: "Auth 身分綁定失敗，自動撤銷新帳號",
    });
    accountRedirect("identity-bind-failed", "create");
  }

  accountRedirect("created", "list", profileId);
}

export async function updateManagedAccount(formData: FormData) {
  await requireRole("laundry_supervisor");
  const parsedForm = parseAccountForm(formData, false);
  const profileId = profileIdSchema.safeParse(textValue(formData.get("profile_id")));
  const requestId = z.uuid().safeParse(textValue(formData.get("change_request_id")));
  if (!parsedForm.success || !profileId.success || !requestId.success) {
    accountRedirect("invalid-update", "edit");
  }
  const parsed = parsedForm.data;

  const account = await getManagedAccount(profileId.data);
  const admin = createSupabaseAdminClient();
  if (!account || account.deleted_at) accountRedirect("account-not-found", "list");
  if (!admin) accountRedirect("auth-admin-unavailable", "edit", profileId.data);

  const identity = await getAuthIdentity(admin, profileId.data);
  const previousAuthEmail = internalAuthEmail(account.login_name);
  const requestedAuthEmail = internalAuthEmail(parsed.loginName);
  const authIdentityChanged = Boolean(identity) && (
    previousAuthEmail !== requestedAuthEmail ||
    account.login_name !== parsed.loginName ||
    (account.display_name ?? "") !== parsed.displayName
  );
  if (identity && authIdentityChanged) {
    const { error } = await admin.auth.admin.updateUserById(identity.auth_user_id, {
      email: requestedAuthEmail,
      email_confirm: true,
      user_metadata: { login_name: parsed.loginName, display_name: parsed.displayName || null },
    });
    if (error) accountRedirect("auth-update-failed", "edit", profileId.data);
  }

  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("manage_user_account", {
    target_profile_id: profileId.data,
    requested_login_name: parsed.loginName,
    requested_display_name: parsed.displayName || null,
    requested_notification_email: parsed.notificationEmail || null,
    requested_account_active: formData.get("account_active") === "on",
    requested_memberships: parsed.memberships,
    change_request_id: requestId.data,
    change_reason: parsed.reason,
  });
  const result = manageResultSchema.safeParse(data);
  if (error || !result.success || result.data.length !== 1 || !result.data[0]) {
    if (identity && authIdentityChanged) {
      await admin.auth.admin.updateUserById(identity.auth_user_id, {
        email: previousAuthEmail,
        email_confirm: true,
        user_metadata: { login_name: account.login_name, display_name: account.display_name },
      });
    }
    accountRedirect("update-failed", "edit", profileId.data);
  }

  accountRedirect("updated", "list", profileId.data);
}

export async function resetManagedAccountPassword(formData: FormData) {
  await requireRole("laundry_supervisor");
  const profileId = profileIdSchema.safeParse(textValue(formData.get("profile_id")));
  const requestId = z.uuid().safeParse(textValue(formData.get("change_request_id")));
  const reason = changeReasonSchema.safeParse(textValue(formData.get("change_reason")));
  const password = temporaryPasswordSchema.safeParse(textValue(formData.get("temporary_password")));
  const confirmation = textValue(formData.get("password_confirmation"));
  if (
    !profileId.success || !requestId.success || !reason.success || !password.success ||
    password.data !== confirmation
  ) accountRedirect("invalid-password", "password");

  const account = await getManagedAccount(profileId.data);
  const admin = createSupabaseAdminClient();
  if (!account || !account.account_active || account.deleted_at || account.is_current_account) {
    accountRedirect("password-account-invalid", "password");
  }
  if (!admin) accountRedirect("auth-admin-unavailable", "password");
  const identity = await getAuthIdentity(admin, profileId.data);
  if (!identity) accountRedirect("auth-identity-missing", "password");

  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { error: prepareError } = await supabase.rpc("mark_managed_account_password_reset", {
    target_profile_id: profileId.data,
    change_request_id: requestId.data,
    change_reason: reason.data,
  });
  if (prepareError) accountRedirect("password-reset-failed", "password", profileId.data);

  const { error: authError } = await admin.auth.admin.updateUserById(identity.auth_user_id, {
    password: password.data,
  });
  if (authError) accountRedirect("password-auth-failed", "password", profileId.data);
  accountRedirect("password-reset", "list", profileId.data);
}

export async function deleteManagedAccount(formData: FormData) {
  await requireRole("laundry_supervisor");
  const profileId = profileIdSchema.safeParse(textValue(formData.get("profile_id")));
  const requestId = z.uuid().safeParse(textValue(formData.get("change_request_id")));
  const reason = changeReasonSchema.safeParse(textValue(formData.get("change_reason")));
  const expectedLogin = textValue(formData.get("expected_login_name"));
  if (!profileId.success || !requestId.success || !reason.success || formData.get("confirmed") !== "yes") {
    accountRedirect("invalid-delete", "delete");
  }

  const account = await getManagedAccount(profileId.data);
  if (!account || account.deleted_at || account.is_current_account || expectedLogin !== account.login_name) {
    accountRedirect("delete-confirmation-mismatch", "delete", profileId.data);
  }
  const admin = createSupabaseAdminClient();
  if (!admin) accountRedirect("auth-admin-unavailable", "delete", profileId.data);
  const identity = await getAuthIdentity(admin, profileId.data);

  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { error } = await supabase.rpc("retire_managed_user_account", {
    target_profile_id: profileId.data,
    change_request_id: requestId.data,
    change_reason: reason.data,
  });
  if (error) accountRedirect("delete-failed", "delete", profileId.data);

  if (identity) {
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(identity.auth_user_id);
    if (authDeleteError) accountRedirect("deleted-auth-pending", "list", profileId.data);
  }
  accountRedirect("deleted", "list", profileId.data);
}

export async function importManagedAccountPermissions(formData: FormData) {
  await requireRole("laundry_supervisor");
  const requestId = z.uuid().safeParse(textValue(formData.get("change_request_id")));
  const reason = changeReasonSchema.safeParse(textValue(formData.get("change_reason")));
  const upload = formData.get("permission_csv");

  if (
    !requestId.success ||
    !reason.success ||
    !(upload instanceof File) ||
    upload.size === 0 ||
    upload.size > 512 * 1024
  ) {
    accountRedirect("invalid-batch-permissions", "batch");
  }

  let table: string[][];
  try {
    table = parse(await upload.text(), {
      bom: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch {
    accountRedirect("invalid-batch-permissions", "batch");
  }

  const [headers, ...records] = table;
  if (
    !headers ||
    headers.length !== batchPermissionCsvHeaders.length ||
    headers.some((header, index) => header !== batchPermissionCsvHeaders[index]) ||
    records.length === 0 ||
    records.length > 500 ||
    records.some((record) => record.length !== batchPermissionCsvHeaders.length)
  ) {
    accountRedirect("invalid-batch-permissions", "batch");
  }

  let rows: Array<z.infer<typeof batchPermissionRowSchema>>;
  try {
    rows = records.map((record) =>
      batchPermissionRowSchema.parse({
        login_name: record[0],
        role: record[1],
        site_code: optionalCode(record[2]),
        institution_code: optionalCode(record[3]),
        account_active: parseBoolean(record[4]),
        membership_active: parseBoolean(record[5]),
      }),
    );
  } catch {
    accountRedirect("invalid-batch-permissions", "batch");
  }

  const accountStates = new Map<string, boolean>();
  const membershipKeys = new Set<string>();
  for (const row of rows) {
    const accountKey = row.login_name.toLowerCase();
    const previousState = accountStates.get(accountKey);
    if (previousState !== undefined && previousState !== row.account_active) {
      accountRedirect("invalid-batch-permissions", "batch");
    }
    accountStates.set(accountKey, row.account_active);

    const membershipKey = [
      accountKey,
      row.role,
      row.site_code ?? "",
      row.institution_code ?? "",
    ].join("|");
    if (membershipKeys.has(membershipKey)) {
      accountRedirect("invalid-batch-permissions", "batch");
    }
    membershipKeys.add(membershipKey);
  }

  const accounts = await listManagedAccounts();
  if (!accounts) accountRedirect("batch-unavailable", "batch");
  const accountByLogin = new Map(accounts.map((account) => [account.login_name.toLowerCase(), account]));
  const normalizedRows = rows.map((row) => {
    const account = accountByLogin.get(row.login_name.toLowerCase());
    if (!account || account.deleted_at || !account.auth_identity_configured || account.is_current_account) {
      accountRedirect("batch-unmanaged-account", "batch");
    }
    return {
      ...row,
      login_name: account.login_name,
      email: internalAuthEmail(account.login_name),
    };
  });

  const supabase = await createServerSupabaseClient({ cookieWritesRequired: true });
  const { data, error } = await supabase.rpc("apply_managed_account_permission_changes", {
    change_rows: normalizedRows,
    change_request_id: requestId.data,
    change_reason: reason.data,
  });
  const result = batchPermissionResultSchema.safeParse(data);
  if (error || !result.success || result.data.length !== 1) {
    accountRedirect("batch-permissions-failed", "batch");
  }

  accountRedirect(
    result.data[0].already_applied ? "batch-permissions-replayed" : "batch-permissions-applied",
    "list",
  );
}
