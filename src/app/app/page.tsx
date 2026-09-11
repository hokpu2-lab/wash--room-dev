import { redirect } from "next/navigation";

import { primaryRoleEntryPath } from "@/lib/auth/access-role-labels";
import { requirePrincipal } from "@/lib/auth/principal";

export default async function AppEntryPage() {
  const principal = await requirePrincipal();
  redirect(primaryRoleEntryPath(principal.memberships.map((membership) => membership.role)));
}
