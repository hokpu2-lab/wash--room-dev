"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { AccessRole } from "@/lib/auth/access-role-labels";

import { AppLink } from "./app-link";
import type { WorkspaceLink } from "./workspace-shell";
import { WorkspaceScopeSwitcher, type ScopeOption } from "./workspace-scope-switcher";
import {
  hrefWithClientScope,
  pathOnly,
  readClientWorkspaceScope,
  rememberClientWorkspaceScope,
  resolveClientWorkspaceScope,
  setAuthorizedSiteIds,
} from "./workspace-scope-client";
import styles from "./workspace-shell.module.css";

type WorkspaceNavigationProps = {
  links: WorkspaceLink[];
  scopes?: Array<{ code: string; name: string; role: AccessRole }>;
  sites: ScopeOption[];
};

export function WorkspaceNavigation({ links, sites }: WorkspaceNavigationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const siteFromUrl = searchParams.get("site");
  const institutionFromUrl = searchParams.get("institution");
  setAuthorizedSiteIds(sites.map((site) => site.id));
  useEffect(() => {
    if (siteFromUrl || institutionFromUrl) {
      rememberClientWorkspaceScope({
        siteId: siteFromUrl && siteFromUrl.length > 0 ? siteFromUrl : readClientWorkspaceScope().siteId,
        institutionId: institutionFromUrl && institutionFromUrl.length > 0 ? institutionFromUrl : readClientWorkspaceScope().institutionId,
      });
    }
  }, [siteFromUrl, institutionFromUrl, sites]);
  const scope = resolveClientWorkspaceScope(searchParams);
  const scopedLinks = useMemo(
    () => links.map((link) => ({ ...link, href: hrefWithClientScope(pathOnly(link.href), scope) })),
    [links, scope.siteId, scope.institutionId],
  );
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-Hant");
    if (!normalized) return [];
    return scopedLinks
      .filter((link) => `${link.label} ${link.description}`.toLocaleLowerCase("zh-Hant").includes(normalized))
      .slice(0, 6);
  }, [scopedLinks, query]);

  const groupedLinks = (group: WorkspaceLink["group"]) =>
    scopedLinks.filter((link) => link.group === group);

  return (
    <>
      <WorkspaceScopeSwitcher sites={sites} />
      <div className={styles.searchArea}>
        <label className={styles.searchBox}>
          <span aria-hidden="true">⌕</span>
          <span className={styles.srOnly}>搜尋功能</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋洗衣單、機構、車號或批次"
            autoComplete="off"
          />
        </label>
        {query ? (
          <div className={styles.searchResults} aria-label="搜尋結果">
            {matches.length ? matches.map((link) => (
              <AppLink key={`${link.href}:${link.label}`} href={link.href} onClick={() => setQuery("")}>
                <span>{link.marker}</span>
                <strong>{link.label}<small>{link.description}</small></strong>
              </AppLink>
            )) : <p>找不到符合的功能。</p>}
          </div>
        ) : null}
      </div>

      <nav className={styles.navigation} aria-label="主要功能">
        <NavGroup title="WORKSPACE" links={groupedLinks("workspace")} pathname={pathname} />
        <NavGroup title="MANAGEMENT" links={groupedLinks("management")} pathname={pathname} />
      </nav>
    </>
  );
}

function NavGroup({ title, links, pathname }: { title: string; links: WorkspaceLink[]; pathname: string }) {
  if (!links.length) return null;
  return (
    <section className={styles.navGroup}>
      <p>{title}</p>
      {links.map((link) => {
        const path = pathOnly(link.href);
        const active = pathname === path || (path !== "/app/admin" && pathname.startsWith(`${path}/`));
        return (
          <AppLink key={`${link.href}:${link.label}`} href={link.href} aria-current={active ? "page" : undefined}>
            <span>{link.marker}</span>
            <strong>{link.label}</strong>
          </AppLink>
        );
      })}
    </section>
  );
}
