import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const api = `http://127.0.0.1:${process.env.API_PORT ?? 3100}`

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    allowedHosts: [".gs.localhost", "localhost"],
    proxy: {
      "/api": { target: api },
      "/healthz": { target: api },
      "/ws": { target: api.replace("http", "ws"), ws: true },
    },
  },
  build: { outDir: "dist", assetsInlineLimit: 0, sourcemap: false },
  test: { name: "web", environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
})
