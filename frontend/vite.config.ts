import path from "path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      "@backend": path.resolve(__dirname, "../backend/src"),
      // Share the backend's hono installation so Vite bundles only one copy and
      // the hc<AppType>() RPC client resolves the same types at runtime as the
      // tsconfig paths above.
      hono: path.resolve(__dirname, "../backend/node_modules/hono"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
