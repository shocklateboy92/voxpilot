import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"

const apiTarget = process.env.VOXPILOT_API_TARGET ?? "http://127.0.0.1:8000"

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    proxy: {
      "/oc": {
        target: apiTarget,
        changeOrigin: true,
      },
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
})
