import { defineConfig } from "@playwright/test";
import { loadEnv } from "vite";

// Match `just dev`: inherit the machine's normal OpenCode config and credentials.
const env = loadEnv("development", "..", "");
const password = process.env.OPENCODE_PASSWORD ?? env.OPENCODE_PASSWORD ?? "";
process.env.OPENCODE_PASSWORD = password;
const baseURL = process.env.VOXPILOT_E2E_URL ?? "http://localhost:13000";
const api = process.env.VOXPILOT_E2E_API ?? "http://127.0.0.1:8001";
const backend = new URL(api);
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
  use: {
    baseURL,
  },
  webServer: [
    {
      command:
        'cd .. && just build-plugin && VOXPILOT_PLUGIN_DIR="$PWD/plugin" packaging/voxpilot-opencode',
      url: `${api}/api/info`,
      reuseExistingServer: true,
      env: {
        OPENCODE_PASSWORD: password,
        VOXPILOT_HOSTNAME: "127.0.0.1",
        VOXPILOT_PORT: backend.port || "80",
      },
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --port ${frontend.port || "80"} --strictPort`,
      url: baseURL,
      reuseExistingServer: true,
      env: { VOXPILOT_API_TARGET: api },
      timeout: 30_000,
    },
  ],
});
