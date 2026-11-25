import express from "express";
import {
  BULL_BOARD_PATH,
  createBullBoardRouter,
  type BullBoardOptions,
} from "./admin/bullBoard.js";
import { createDevUserMiddleware } from "./middleware/devUser.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { createHealthRouter, type HealthChecks } from "./routes/health.js";
import { createScheduleRouter, type ScheduleDeps } from "./routes/schedule.js";
import { createSearchRouter, type SearchDeps } from "./routes/search.js";

export interface AppOptions {
  timeoutMs?: number;
  schedule?: ScheduleDeps;
  search?: SearchDeps;
  bullBoard?: BullBoardOptions;
}

export function createApp(healthChecks: HealthChecks, opts: AppOptions = {}) {
  const app = express();
  // Room for MAX_LEADS_PER_CAMPAIGN addresses plus a long body.
  app.use(express.json({ limit: "2mb" }));
  app.use("/health", createHealthRouter(healthChecks, opts.timeoutMs));

  if (opts.bullBoard) {
    const board = createBullBoardRouter(opts.bullBoard);
    if (board) app.use(BULL_BOARD_PATH, board);
  }

  if (opts.schedule || opts.search) {
    const api = express.Router();
    api.use(createDevUserMiddleware()); // TODO(M8): swap for requireAuth
    if (opts.schedule) api.use("/schedule", createScheduleRouter(opts.schedule));
    if (opts.search) api.use("/search", createSearchRouter(opts.search));
    app.use("/api", api);
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
