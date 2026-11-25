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
  // The compose page warns before the server would reject a too-long list.
  // Same .env value the API enforces; the server stays the source of truth.
  const maxLeads = Number(process.env.MAX_LEADS_PER_CAMPAIGN ?? rootEnv.MAX_LEADS_PER_CAMPAIGN ?? 10000);

  return {
    plugins: [react(), tailwindcss()],
    define: { __MAX_LEADS_PER_CAMPAIGN__: JSON.stringify(maxLeads) },
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
