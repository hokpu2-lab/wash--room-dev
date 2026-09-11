"use client";

import { useFormStatus } from "react-dom";

export function PasswordSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "儲存中…" : "儲存新密碼並進入系統"}
    </button>
  );
}
