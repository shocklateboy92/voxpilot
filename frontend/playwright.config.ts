import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";
import { loadEnv } from "vite";

// Keep normal configuration, but never reuse the normal backend or database.
const env = loadEnv("development", "..", "");
const password =
  process.env.OPENCODE_PASSWORD || env.OPENCODE_PASSWORD || randomUUID();
process.env.OPENCODE_PASSWORD = password;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // CDP reuses the user's browser context, including shared local storage.
  workers: process.env.VOXPILOT_E2E_CDP ? 1 : 6,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/setup.ts",
});
