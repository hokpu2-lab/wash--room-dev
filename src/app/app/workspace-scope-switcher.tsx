"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { readClientWorkspaceScope, rememberClientWorkspaceScope } from "./workspace-scope-client";
import { setWorkspaceSiteAction } from "./workspace-scope-actions";
import styles from "./workspace-shell.module.css";

export type ScopeOption = { id: string; name: string; code: string };

export function WorkspaceScopeSwitcher({ sites }: { sites: ScopeOption[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get("site") ?? readClientWorkspaceScope().siteId ?? "";

  if (sites.length < 2) return null;

  return (
    <label className={styles.scopeSwitch}>
      <span>作業範圍</span>
      <select
        value={selected}
        aria-label="切換作業範圍"
        onChange={(event) => {
          const next = event.target.value;
          void setWorkspaceSiteAction(next || null);
          rememberClientWorkspaceScope({ siteId: next || null, institutionId: null });
          const params = new URLSearchParams(searchParams.toString());
          if (next) params.set("site", next);
          else params.delete("site");
          const query = params.toString();
          router.replace(query ? `${pathname}?${query}` : pathname);
        }}
      >
        <option value="">全部</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
    </label>
  );
}
