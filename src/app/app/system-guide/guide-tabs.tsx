"use client";

import { Children, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import styles from "./system-guide.module.css";

type GuideTab = {
  id: string;
  label: string;
  description: string;
};

export function GuideTabs({ tabs, children }: { tabs: GuideTab[]; children: ReactNode }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? "");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panels = Children.toArray(children);

  function activate(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    setActiveId(tab.id);
    tabRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    activate(nextIndex);
  }

  if (!tabs.length) return null;

  return (
    <div className={styles.guideTabs}>
      <div className={styles.tabList} role="tablist" aria-label="系統說明分類">
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[index] = element; }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`system-guide-panel-${tab.id}`}
              id={`system-guide-tab-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? styles.tabActive : styles.tab}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <strong>{tab.label}</strong>
              <small>{tab.description}</small>
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => (
        <section
          key={tab.id}
          id={`system-guide-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`system-guide-tab-${tab.id}`}
          hidden={tab.id !== activeId}
          tabIndex={0}
          className={styles.tabPanel}
        >
          {panels[index] ?? null}
        </section>
      ))}
    </div>
  );
}
