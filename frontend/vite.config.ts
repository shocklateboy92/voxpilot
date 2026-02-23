import path from "path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

const apiTarget = process.env.VOXPILOT_API_TARGET ?? "http://127.0.0.1:8000";

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
    allowedHosts: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          // Prevent buffering of SSE streams so events are forwarded immediately
          proxy.on("proxyRes", (proxyRes) => {
            const contentType = proxyRes.headers["content-type"] ?? "";
            if (contentType.includes("text/event-stream")) {
              proxyRes.headers["Cache-Control"] = "no-cache";
              proxyRes.headers["X-Accel-Buffering"] = "no";
            }
          });
        },
      },
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
