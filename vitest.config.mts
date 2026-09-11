import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/database/**/*.spec.ts", "tests/unit/**/*.spec.ts"],
    reporters: "default",
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
