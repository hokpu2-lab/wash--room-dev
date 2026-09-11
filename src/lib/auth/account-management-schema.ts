import { z } from "zod";

import { accessRoleSchema } from "./access-role";

export const loginNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/);

export const temporaryPasswordSchema = z
  .string()
  .min(12)
  .max(72)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/)
  .regex(/[^A-Za-z0-9]/);

export const accountMembershipInputSchema = z
  .object({
    role: accessRoleSchema,
    site_code: z.string().min(1).nullable(),
    institution_code: z.string().min(1).nullable(),
  })
  .superRefine((membership, context) => {
    const siteRole =
      membership.role === "system_administrator" ||
      membership.role === "laundry_worker" ||
      membership.role === "laundry_supervisor";
    const valid = siteRole
      ? Boolean(membership.site_code) && membership.institution_code === null
      : membership.site_code === null && Boolean(membership.institution_code);
    if (!valid) context.addIssue({ code: "custom", message: "角色與權限範圍不一致" });
  });

export const accountMembershipSchema = accountMembershipInputSchema.and(
  z.object({
    membership_id: z.uuid(),
    site_name: z.string().nullable(),
    institution_name: z.string().nullable(),
    active: z.boolean(),
  }),
);

export const managedAccountSchema = z.object({
  profile_id: z.uuid(),
  login_name: loginNameSchema,
  display_name: z.string().nullable(),
  notification_email: z.string().nullable(),
  account_active: z.boolean(),
  must_change_password: z.boolean(),
  deleted_at: z.string().nullable(),
  auth_identity_configured: z.boolean(),
  is_current_account: z.boolean(),
  memberships: z.array(accountMembershipSchema),
});

export type AccountMembershipInput = z.infer<typeof accountMembershipInputSchema>;
export type ManagedAccount = z.infer<typeof managedAccountSchema>;

export function internalAuthEmail(loginName: string) {
  return `${loginName.toLowerCase()}@auth.wash-room.invalid`;
}
