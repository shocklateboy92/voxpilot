import { test as base, expect } from "@playwright/test";
import { createServer } from "vite";
import { credentialSource, startTestBackend } from "./backend";
import { client, makeClient, model, password } from "./dev";
import { apiURL, frontendURL, workerIndex } from "./endpoints";

type Frontend = { frontendURL: string };
type Servers = Frontend & { root: string };

/** Browser/module tests that need Vite but no backend or provider account. */
export const frontendTest = base.extend<
  Record<never, never>,
  { frontend: Frontend }
>({
  frontend: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires fixture destructuring
    async ({}, use) => {
      const frontend = new URL(frontendURL);
      const vite = await createServer({
        cacheDir: `node_modules/.vite/e2e/worker-${workerIndex}`,
        logLevel: "error",
        clearScreen: false,
        server: {
          host: frontend.hostname.replace(/^\[|\]$/g, ""),
          port: Number(frontend.port || "80"),
          strictPort: true,
          proxy: {
            "/api": { target: apiURL, changeOrigin: true },
            "/auth": { target: apiURL, changeOrigin: true },
          },
        },
      });
      try {
        await vite.listen();
        await use({ frontendURL });
      } finally {
        await vite.close();
      }
    },
    { scope: "worker", timeout: 60_000 },
  ],
  baseURL: async ({ frontend }, use) => {
    await use(frontend.frontendURL);
  },
});

export const test = frontendTest.extend<
  { sessionIsolation: undefined },
  { servers: Servers }
>({
  servers: [
    async ({ frontend }, use, info) => {
      expect(workerIndex).toBe(info.workerIndex);
      const source = await credentialSource();
      // Copy only the active test provider account, in memory, into this worker.
      const credentials = (await source.credential.list()).filter(
        (credential) =>
          credential.integrationID === model.providerID && credential.active,
      );
      if (credentials.length === 0)
        throw new Error("E2E requires an active GitHub Copilot credential");
      const backend = await startTestBackend(apiURL, password);
      try {
        try {
          for (const credential of credentials) {
            await backend.client.credential.create({
              integrationID: credential.integrationID,
              label: credential.label,
              value: credential.value,
              activate: true,
            });
          }
        } catch {
          // Credential API errors can include sensitive inputs.
          throw new Error("Could not seed the isolated worker's credentials");
        }
        expect((await makeClient(frontend.frontendURL).server.info()).pid).toBe(
          (await backend.client.server.info()).pid,
        );
        await use({ ...frontend, root: backend.root });
      } finally {
        await backend.stop();
      }
    },
    { scope: "worker", auto: true, timeout: 60_000 },
  ],
  sessionIsolation: [
    async ({ servers }, use) => {
      // This automatic fixture surrounds workspace/page setup and teardown.
      expect(servers.frontendURL).toBe(frontendURL);
      expect(
        (await client.session.list()).data,
        "Sessions before test",
      ).toEqual([]);
      await use(undefined);
      expect(
        (await client.session.list()).data,
        "Leaked sessions after test",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
