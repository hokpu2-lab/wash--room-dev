"use client";

import { useEffect, useState } from "react";
import { gsap } from "gsap";

import styles from "./workspace-shell.module.css";

const STORAGE_KEY = "wash-room-workspace-style";

export const workspaceStyles = ["MX", "AP", "GS", "MB", "SH"] as const;
export type WorkspaceStyle = (typeof workspaceStyles)[number];

const styleLabels: Record<WorkspaceStyle, string> = {
  MX: "MX · 現行營運",
  AP: "AP · Apple Flow",
  GS: "GS · Kinetic System",
  MB: "MB · Editorial UI",
  SH: "SH · shadcn UI",
};

function isWorkspaceStyle(value: string | null): value is WorkspaceStyle {
  return value !== null && workspaceStyles.includes(value as WorkspaceStyle);
}

function applyWorkspaceStyle(style: WorkspaceStyle) {
  document.documentElement.dataset.workspaceStyle = style;
  document.querySelector<HTMLElement>("[data-workspace-shell]")?.setAttribute("data-workspace-style", style);
}

export function StyleSwitcher() {
  const [style, setStyle] = useState<WorkspaceStyle>("MX");

  useEffect(() => {
    const savedStyle = window.localStorage.getItem(STORAGE_KEY);
    if (!isWorkspaceStyle(savedStyle)) return;
    const frame = window.requestAnimationFrame(() => setStyle(savedStyle));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    applyWorkspaceStyle(style);
    const root = document.querySelector<HTMLElement>("[data-workspace-shell]");
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        root,
        { opacity: 0.86, y: -5 },
        { opacity: 1, y: 0, duration: 0.42, ease: "power2.out", overwrite: true },
      );
    }, root);

    return () => context.revert();
  }, [style]);

  function handleChange(nextStyle: WorkspaceStyle) {
    setStyle(nextStyle);
    window.localStorage.setItem(STORAGE_KEY, nextStyle);
  }

  return (
    <label className={styles.styleSwitcher}>
      <span className={styles.styleSwitcherLabel}>風格</span>
      <select
        aria-label="切換介面風格"
        value={style}
        onChange={(event) => handleChange(event.target.value as WorkspaceStyle)}
      >
        {workspaceStyles.map((option) => (
          <option key={option} value={option}>
            {styleLabels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
