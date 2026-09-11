"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}>
      列印固定 QR
    </button>
  );
}
