export const accessRoles = [
  "system_administrator",
  "laundry_worker",
  "laundry_supervisor",
  "institution_supervisor",
] as const;

export type AccessRole = (typeof accessRoles)[number];

export const accessRoleLabels: Record<AccessRole, string> = {
  system_administrator: "系統管理員",
  laundry_worker: "洗衣員",
  laundry_supervisor: "洗衣主管",
  institution_supervisor: "送洗機構主管",
};

export function primaryRole(roles: AccessRole[]) {
  if (roles.includes("system_administrator")) return "system_administrator" as const;
  if (roles.includes("laundry_supervisor")) return "laundry_supervisor" as const;
  if (roles.includes("laundry_worker")) return "laundry_worker" as const;
  return "institution_supervisor" as const;
}

export function primaryRoleEntryPath(roles: AccessRole[]) {
  return roleEntryPath(primaryRole(roles));
}

export function roleEntryPath(role: AccessRole) {
  switch (role) {
    case "system_administrator":
    case "laundry_supervisor":
      return "/app/admin";
    case "laundry_worker":
      return "/app/operations";
    case "institution_supervisor":
      return "/app/institution";
  }
}

export function workspaceEntryHref(membership: {
  role: AccessRole;
  operating_site_id?: string | null;
  institution_id?: string | null;
}) {
  const path = roleEntryPath(membership.role);
  if (
    (membership.role === "system_administrator" || membership.role === "laundry_supervisor") &&
    membership.operating_site_id
  ) {
    return `${path}?site=${membership.operating_site_id}`;
  }
  if (membership.role === "institution_supervisor" && membership.institution_id) {
    return `${path}?institution=${membership.institution_id}`;
  }
  return path;
}

export function isLaundrySupervisorRole(role: AccessRole): boolean {
  return role === "laundry_supervisor" || role === "system_administrator";
}

export function isSiteRole(role: AccessRole): boolean {
  return role === "laundry_worker" || role === "laundry_supervisor" || role === "system_administrator";
}
