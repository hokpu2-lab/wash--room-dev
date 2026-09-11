"use client";

import { useFormStatus } from "react-dom";

export function LogoutSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "登出中…" : "登出"}
    </button>
  );
}
