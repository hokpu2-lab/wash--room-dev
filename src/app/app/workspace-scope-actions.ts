"use server";

import { cookies } from "next/headers";

import { isScopeId, workspaceScopeCookieNames } from "@/lib/auth/workspace-scope";

const options = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };

export async function setWorkspaceSiteAction(siteId: string | null) {
  const jar = await cookies();
  if (siteId && isScopeId(siteId)) {
    jar.set(workspaceScopeCookieNames.site, siteId, options);
    return;
  }
  jar.delete(workspaceScopeCookieNames.site);
}
