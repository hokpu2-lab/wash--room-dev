export const SYSTEM_GUIDE_ADMIN_LOGIN = "admin";

export function isSystemGuideAdministrator(principal: {
  loginName?: string;
  memberships: Array<{ role: string }>;
}) {
  return (
    principal.loginName === SYSTEM_GUIDE_ADMIN_LOGIN &&
    principal.memberships.some((membership) => membership.role === "laundry_supervisor")
  );
}
