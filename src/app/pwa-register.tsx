"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
      return;
    }
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, []);
  return null;
}
