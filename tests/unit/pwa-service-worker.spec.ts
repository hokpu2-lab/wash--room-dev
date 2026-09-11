import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { expect, test } from "vitest";

type FetchEvent = {
  request: { method: string; url: string };
  respondWith: (response: Promise<unknown>) => void;
};

test("PWA 不快取依 session 決定內容的首頁", () => {
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const source = readFileSync("public/sw.js", "utf8");
  runInNewContext(source, {
    URL,
    Promise,
    caches: {
      match: () => Promise.resolve(undefined),
      open: () => Promise.resolve({ addAll: () => Promise.resolve(), put: () => Promise.resolve() }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
    },
    fetch: () => Promise.resolve({ ok: false }),
    self: {
      addEventListener: (type: string, handler: (event: FetchEvent) => void) => {
        handlers.set(type, handler);
      },
    },
  });

  let rootIntercepted = false;
  handlers.get("fetch")?.({
    request: { method: "GET", url: "https://wash-room.example/" },
    respondWith: () => { rootIntercepted = true; },
  });
  let loginIntercepted = false;
  handlers.get("fetch")?.({
    request: { method: "GET", url: "https://wash-room.example/login" },
    respondWith: () => { loginIntercepted = true; },
  });

  expect(rootIntercepted).toBe(false);
  expect(loginIntercepted).toBe(true);
});
