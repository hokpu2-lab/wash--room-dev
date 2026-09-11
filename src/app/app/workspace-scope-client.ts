"use client";

const SITE_KEY = "wr_workspace_site";
const INSTITUTION_KEY = "wr_workspace_institution";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ClientWorkspaceScope = {
  siteId: string | null;
  institutionId: string | null;
};

function readStorage(key: string) {
  try {
    const value = window.sessionStorage.getItem(key);
    return value && uuidPattern.test(value) ? value : null;
  } catch {
    return null;
  }
}

let authorizedSiteIds: string[] = [];

export function setAuthorizedSiteIds(ids: string[]) {
  authorizedSiteIds = ids.filter(Boolean);
}

export function getAuthorizedSiteIds() {
  return authorizedSiteIds;
}

export function rememberClientWorkspaceScope(scope: ClientWorkspaceScope) {
  try {
    if (scope.siteId && uuidPattern.test(scope.siteId)) window.sessionStorage.setItem(SITE_KEY, scope.siteId);
    else window.sessionStorage.removeItem(SITE_KEY);
    if (scope.institutionId && uuidPattern.test(scope.institutionId)) {
      window.sessionStorage.setItem(INSTITUTION_KEY, scope.institutionId);
    } else {
      window.sessionStorage.removeItem(INSTITUTION_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function readClientWorkspaceScope(): ClientWorkspaceScope {
  return {
    siteId: readStorage(SITE_KEY),
    institutionId: readStorage(INSTITUTION_KEY),
  };
}

export function resolveClientWorkspaceScope(search: URLSearchParams): ClientWorkspaceScope {
  const siteId = search.get("site");
  const institutionId = search.get("institution");
  const stored = readClientWorkspaceScope();
  return {
    siteId: siteId && uuidPattern.test(siteId) ? siteId : stored.siteId,
    institutionId:
      institutionId && uuidPattern.test(institutionId) ? institutionId : stored.institutionId,
  };
}

export function hrefWithClientScope(href: string, scope: ClientWorkspaceScope) {
  const [path, existing] = href.split("?");
  const params = new URLSearchParams(existing ?? "");
  if (scope.siteId) params.set("site", scope.siteId);
  if (scope.institutionId) params.set("institution", scope.institutionId);
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : href;
}

export function pathOnly(href: string) {
  return href.split("?")[0] ?? href;
}
