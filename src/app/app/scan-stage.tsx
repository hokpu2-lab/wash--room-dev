"use client";

import type { ReactNode } from "react";

import styles from "./workspace.module.css";

type ScanStageProps = {
  scanned: boolean;
  waitingText: string;
  readyText: string;
  children: ReactNode;
};

export function ScanStage({ scanned, waitingText, readyText, children }: ScanStageProps) {
  return (
    <section className={styles.scanStage}>
      <div className={styles.scanVisual} aria-hidden="true">
        <span className={styles.scanGlyph}>▦</span>
        <span className={scanned ? styles.scanBeam : styles.scanIdle} />
      </div>
      <div className={styles.scanCopy}>
        <p className={styles.scanReady}>{scanned ? "● READY TO SCAN" : "○ WAITING FOR QR"}</p>
        <p>{scanned ? readyText : waitingText}</p>
        {children}
      </div>
    </section>
  );
}
