"use client";

import { useSearchParams } from "next/navigation";

import styles from "./login.module.css";

export function LoginError() {
  const error = useSearchParams().get("error");
  if (error !== "credentials") return null;
  return (
    <p className={styles.formError} role="alert">
      帳號或密碼不正確，請重新輸入。
    </p>
  );
}
