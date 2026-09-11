import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PwaRegister } from "./pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "洗衣管理系統",
    template: "%s｜洗衣管理系統",
  },
  description: "內部洗衣作業與固定資產 QR 管理系統",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
