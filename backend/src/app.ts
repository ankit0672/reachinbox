import express from "express";
import { createHealthRouter, type HealthChecks } from "./routes/health.js";

export function createApp(healthChecks: HealthChecks, opts: { timeoutMs?: number } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/health", createHealthRouter(healthChecks, opts.timeoutMs));
  return app;
}
