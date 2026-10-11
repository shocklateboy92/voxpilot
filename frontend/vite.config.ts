import { access, readFile } from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

const apiTarget = process.env.VOXPILOT_API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  // Concurrent browser-test servers must not invalidate the live dev cache.
  cacheDir: process.env.VOXPILOT_VITE_CACHE_DIR ?? "node_modules/.vite/dev",
  plugins: [
    tailwindcss(),
    solidPlugin(),
    {
      name: "protect-deployment-credentials",
      apply: "build",
      async buildStart() {
        try {
          await access(path.resolve(__dirname, "public/config.json"));
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return;
          throw new Error(
            "Could not check public/config.json for deployment credentials.",
          );
        }
        throw new Error(
          "Move public/config.json out of public before building: deployment credentials must not enter releases.",
        );
      },
    },
    {
      name: "runtime-connection-config",
      apply: "serve",
      configureServer(server) {
        // Outside public/: development credentials must never enter a build.
        server.middlewares.use("/config.json", async (_request, response) => {
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "application/json");
          try {
            const config = await readFile(
              path.resolve(__dirname, "config.local.json"),
            );
            response.end(config);
          } catch (error) {
            response.statusCode =
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
                ? 404
                : 500;
            response.end();
          }
        });
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    proxy: {
      "/auth": { target: apiTarget, changeOrigin: true },
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@plugin": path.resolve(__dirname, "../plugin/src"),
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
