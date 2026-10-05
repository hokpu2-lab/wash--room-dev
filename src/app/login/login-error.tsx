"use client";

import { useSearchParams } from "next/navigation";

import styles from "./login.module.css";

export function LoginError() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (error === "sso") {
    return (
      <p className={styles.formError} role="alert">
        單一登入驗證失敗或帳號尚未獲授權，請重新從入口系統登入。
      </p>
    );
  }
  if (error !== "credentials") return null;
  return (
    <p className={styles.formError} role="alert">
      帳號或密碼不正確，請重新輸入。
    </p>
  );
}
