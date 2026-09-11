"use client";

import { Children, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import styles from "./workspace.module.css";

export type ModuleTab = {
  id: string;
  label: string;
  description?: string;
  count?: number;
};

function tabFromHash(validIds: Set<string>) {
  const requested = new URLSearchParams(window.location.hash.slice(1)).get("tab");
  return requested && validIds.has(requested) ? requested : null;
}

export function ModuleTabs({
  ariaLabel,
  storageKey,
  tabs,
  defaultTab,
  children,
}: {
  ariaLabel: string;
  storageKey: string;
  tabs: ModuleTab[];
  defaultTab?: string;
  children: ReactNode;
}) {
  const instanceId = useId().replaceAll(":", "");
  const fallback = tabs.some((tab) => tab.id === defaultTab) ? defaultTab! : tabs[0]?.id ?? "";
  const [activeId, setActiveId] = useState(fallback);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panels = Children.toArray(children);

  useEffect(() => {
    const validIds = new Set(tabs.map((tab) => tab.id));
    const stored = window.localStorage.getItem(`wash-room:module-tab:${storageKey}`);
    const initial = tabFromHash(validIds) ?? (stored && validIds.has(stored) ? stored : null);
    const initialSync = window.setTimeout(() => {
      if (initial) setActiveId(initial);
    }, 0);

    const syncHash = () => {
      const next = tabFromHash(validIds);
      if (next) setActiveId(next);
    };
    window.addEventListener("hashchange", syncHash);
    return () => {
      window.clearTimeout(initialSync);
      window.removeEventListener("hashchange", syncHash);
    };
  }, [storageKey, tabs]);

  if (tabs.length === 0) return null;

  function activate(id: string, updateUrl = true) {
    setActiveId(id);
    window.localStorage.setItem(`wash-room:module-tab:${storageKey}`, id);
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.hash = new URLSearchParams({ tab: id }).toString();
      window.history.replaceState(window.history.state, "", url);
    }
    const index = tabs.findIndex((tab) => tab.id === id);
    tabRefs.current[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    activate(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className={styles.moduleTabs}>
      <div className={styles.moduleTabList} role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[index] = element; }}
              id={`${instanceId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-label={tab.label}
              aria-describedby={tab.description ? `${instanceId}-description-${tab.id}` : undefined}
              aria-selected={selected}
              aria-controls={`${instanceId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? styles.moduleTabActive : styles.moduleTab}
              onClick={() => activate(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className={styles.moduleTabLabel}>{tab.label}</span>
              {typeof tab.count === "number" ? <span aria-hidden="true" className={styles.moduleTabCount}>{tab.count}</span> : null}
              {tab.description ? <small id={`${instanceId}-description-${tab.id}`}>{tab.description}</small> : null}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => {
        const selected = tab.id === activeId;
        return (
          <div
            key={tab.id}
            id={`${instanceId}-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`${instanceId}-tab-${tab.id}`}
            tabIndex={0}
            hidden={!selected}
            className={styles.moduleTabPanel}
          >
            {panels[index] ?? null}
          </div>
        );
      })}
    </div>
  );
}
