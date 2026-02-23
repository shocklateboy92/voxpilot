import path from "path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

const apiTarget = process.env.VOXPILOT_API_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      "@backend": path.resolve(__dirname, "../backend/src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
