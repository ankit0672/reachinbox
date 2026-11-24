import express from "express";
import { createDevUserMiddleware } from "./middleware/devUser.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { createHealthRouter, type HealthChecks } from "./routes/health.js";
import { createScheduleRouter, type ScheduleDeps } from "./routes/schedule.js";

export interface AppOptions {
  timeoutMs?: number;
  schedule?: ScheduleDeps;
}

export function createApp(healthChecks: HealthChecks, opts: AppOptions = {}) {
  const app = express();
  // Room for MAX_LEADS_PER_CAMPAIGN addresses plus a long body.
  app.use(express.json({ limit: "2mb" }));
  app.use("/health", createHealthRouter(healthChecks, opts.timeoutMs));

  if (opts.schedule) {
    const api = express.Router();
    api.use(createDevUserMiddleware()); // TODO(M8): swap for requireAuth
    api.use("/schedule", createScheduleRouter(opts.schedule));
    app.use("/api", api);
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
