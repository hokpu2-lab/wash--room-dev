import { z } from "zod";

import { accessRoles } from "./access-role-labels";

export {
  accessRoleLabels,
  accessRoles,
  isLaundrySupervisorRole,
  isSiteRole,
  primaryRole,
  primaryRoleEntryPath,
  roleEntryPath,
  type AccessRole,
} from "./access-role-labels";

export const accessRoleSchema = z.enum(accessRoles);
