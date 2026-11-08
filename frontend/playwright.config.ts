import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";
import { loadEnv } from "vite";

// Keep normal configuration, but never reuse the normal backend or database.
const env = loadEnv("development", "..", "");
const password =
  process.env.OPENCODE_PASSWORD || env.OPENCODE_PASSWORD || randomUUID();
process.env.OPENCODE_PASSWORD = password;
const baseURL = process.env.VOXPILOT_E2E_URL ?? "http://localhost:13000";
const api = process.env.VOXPILOT_E2E_API ?? "http://127.0.0.1:18001";
const frontend = new URL(baseURL);
process.env.VOXPILOT_E2E_API = api;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/setup.ts",
  use: {
    baseURL,
  },
  webServer: [
    {
      command: `npm run dev -- --port ${frontend.port || "80"} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      env: {
        VOXPILOT_API_TARGET: api,
        VOXPILOT_VITE_CACHE_DIR: "node_modules/.vite/e2e",
      },
      timeout: 30_000,
    },
  ],
});
