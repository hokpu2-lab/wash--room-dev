import { cookies } from "next/headers";

const SITE_COOKIE = "wr_workspace_site";
const INSTITUTION_COOKIE = "wr_workspace_institution";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorkspaceScope = {
  siteId: string | null;
  institutionId: string | null;
};

export function isScopeId(value: string | null | undefined): value is string {
  return Boolean(value && uuidPattern.test(value));
}

export function readScopeFromSearch(
  query: Record<string, string | string[] | undefined>,
): WorkspaceScope {
  const site = typeof query.site === "string" ? query.site : null;
  const institution = typeof query.institution === "string" ? query.institution : null;
  return {
    siteId: isScopeId(site) ? site : null,
    institutionId: isScopeId(institution) ? institution : null,
  };
}

export async function readStoredWorkspaceScope(): Promise<WorkspaceScope> {
  const jar = await cookies();
  const siteId = jar.get(SITE_COOKIE)?.value ?? null;
  const institutionId = jar.get(INSTITUTION_COOKIE)?.value ?? null;
  return {
    siteId: isScopeId(siteId) ? siteId : null,
    institutionId: isScopeId(institutionId) ? institutionId : null,
  };
}

export async function resolveWorkspaceScope(
  query: Record<string, string | string[] | undefined> = {},
): Promise<WorkspaceScope> {
  const fromQuery = readScopeFromSearch(query);
  const stored = await readStoredWorkspaceScope();
  return {
    siteId: fromQuery.siteId ?? stored.siteId,
    institutionId: fromQuery.institutionId ?? stored.institutionId,
  };
}

export function withWorkspaceScope(href: string, scope: WorkspaceScope) {
  const [path, existing] = href.split("?");
  const params = new URLSearchParams(existing ?? "");
  if (scope.siteId) params.set("site", scope.siteId);
  if (scope.institutionId) params.set("institution", scope.institutionId);
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : href;
}

export const workspaceScopeCookieNames = {
  site: SITE_COOKIE,
  institution: INSTITUTION_COOKIE,
} as const;
