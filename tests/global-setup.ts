import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadEnv } from "vite";

export default function setup(): void {
  const env = loadEnv("test", process.cwd(), "");
  execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    env: { ...process.env, ...env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "inherit",
  });
}
