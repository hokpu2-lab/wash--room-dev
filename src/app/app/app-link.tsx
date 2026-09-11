"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";

import { markWorkspaceNavigating } from "./navigation-progress";

type AppLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-current"?: ComponentProps<typeof Link>["aria-current"];
  "aria-label"?: string;
  onClick?: ComponentProps<typeof Link>["onClick"];
};

export function AppLink({ href, children, className, onClick, ...props }: AppLinkProps) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      onClick={(event) => {
        const nextPath = href.split("?")[0] ?? href;
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          nextPath !== pathname
        ) {
          markWorkspaceNavigating();
        }
        onClick?.(event);
      }}
      onMouseEnter={() => router.prefetch(href)}
      onFocus={() => router.prefetch(href)}
      onTouchStart={() => router.prefetch(href)}
      {...props}
    >
      {children}
    </Link>
  );
}
