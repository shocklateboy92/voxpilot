import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

const apiTarget = process.env.VOXPILOT_API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [tailwindcss(), solidPlugin()],
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
