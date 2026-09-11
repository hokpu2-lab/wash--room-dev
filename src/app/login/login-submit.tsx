"use client";

import { useFormStatus } from "react-dom";

type LoginSubmitProps = {
  disabled: boolean;
};

export function LoginSubmit({ disabled }: LoginSubmitProps) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? "登入中…" : "登入"}
    </button>
  );
}
