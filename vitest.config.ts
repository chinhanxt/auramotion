import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: loadEnv("test", process.cwd(), ""),
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
  },
});
