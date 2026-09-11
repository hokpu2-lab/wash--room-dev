"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import styles from "./workspace-shell.module.css";

const EVENT = "workspace:navigating";

export function markWorkspaceNavigating() {
  window.dispatchEvent(new Event(EVENT));
}

export function NavigationProgress() {
  const pathname = usePathname();
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    const start = () => setOrigin(window.location.pathname);
    window.addEventListener(EVENT, start);
    return () => window.removeEventListener(EVENT, start);
  }, []);

  const active = origin !== null && origin === pathname;

  return (
    <div
      className={active ? `${styles.progress} ${styles.progressActive}` : styles.progress}
      aria-hidden="true"
    />
  );
}
