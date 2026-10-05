import path from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solidPlugin from "vite-plugin-solid";

const apiTarget = process.env.VOXPILOT_API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [
    solidPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true,
      },
      manifest: {
        name: "VoxPilot",
        short_name: "VoxPilot",
        // The manifest takes a single static colour (no prefers-color-scheme),
        // so these track the dark theme's --color-surface -- the app's default.
        // index.html updates one theme-color meta once styles are loaded.
        theme_color: "#1a1d27",
        background_color: "#1a1d27",
        display: "standalone",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
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
