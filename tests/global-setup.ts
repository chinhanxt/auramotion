import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadEnv } from "vite";

export default function setup(): void {
  const env = loadEnv("test", process.cwd(), "");
  const dbUrl = env.DATABASE_URL ?? "";
  if (!dbUrl.split("?")[0].endsWith("_test")) {
    throw new Error(`DATABASE_URL must point to a *_test database, got: ${dbUrl.replace(/\/\/([^:/@]*):[^@]*@/, "//$1:***@") || "(empty)"}`);
  }
  execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    env: { ...process.env, ...env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "inherit",
  });
}
