import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Same origin: the browser only talks to this dev server, which forwards
// /api (and /admin for Bull Board) to the API. The port comes from the repo
// root .env (API_PORT), the same file the backend reads. Nothing from that
// file is exposed to the client bundle (no VITE_ prefix is used).
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, "..", "");
  const apiPort = process.env.API_PORT ?? rootEnv.API_PORT ?? "3001";
  const target = `http://localhost:${apiPort}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target },
        "/admin": { target },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      restoreMocks: true,
      // Fixed zone so formatted times are deterministic; the app uses the browser's zone.
      env: { TZ: "UTC" },
    },
  };
});
