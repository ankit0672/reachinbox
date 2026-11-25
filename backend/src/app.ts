import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import {
  BULL_BOARD_PATH,
  createBullBoardRouter,
  type BullBoardOptions,
} from "./admin/bullBoard.js";
import type { AuthConfig } from "./auth/config.js";
import { requireAuth } from "./auth/requireAuth.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { createAuthRouter } from "./routes/auth.js";
import { createEmailsRouter, type EmailsDeps } from "./routes/emails.js";
import { createHealthRouter, type HealthChecks } from "./routes/health.js";
import { createScheduleRouter, type ScheduleDeps } from "./routes/schedule.js";
import { createSearchRouter, type SearchDeps } from "./routes/search.js";
import { createSendersRouter } from "./routes/senders.js";
import { createSlackRouters, type SlackDeps } from "./routes/slack.js";

export interface AppOptions {
  timeoutMs?: number;
  /** Required whenever any /api route is mounted. */
  auth?: AuthConfig;
  schedule?: ScheduleDeps;
  search?: SearchDeps;
  emails?: EmailsDeps;
  slack?: SlackDeps;
  bullBoard?: BullBoardOptions;
}

export function createApp(healthChecks: HealthChecks, opts: AppOptions = {}) {
  const app = express();
  const auth = opts.auth;

  if (auth) {
    // Only the frontend may call the API from a browser, with cookies.
    // Other origins get no CORS headers at all, so the browser blocks them.
    app.use(
      cors({ origin: (origin, cb) => cb(null, origin === auth.frontendUrl), credentials: true }),
    );
  }
  // Room for MAX_LEADS_PER_CAMPAIGN addresses plus a long body.
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.use("/health", createHealthRouter(healthChecks, opts.timeoutMs)); // public

  if (opts.bullBoard) {
    const board = createBullBoardRouter(opts.bullBoard); // its own basic auth
    if (board) app.use(BULL_BOARD_PATH, board);
  }

  if (opts.schedule || opts.search || opts.emails || opts.slack) {
    if (!auth) throw new Error("createApp: /api routes need an auth config");
  }
  if (auth) {
    app.use("/api/auth", createAuthRouter(auth)); // public (login, logout; /me checks itself)
    const slack = opts.slack ? createSlackRouters(opts.slack, auth) : undefined;
    if (slack) app.use("/api/slack", slack.callback); // public: identified by its signed state
    const api = express.Router();
    api.use(requireAuth(auth)); // everything else under /api needs a session
    if (opts.schedule) api.use("/schedule", createScheduleRouter(opts.schedule));
    if (opts.search) api.use("/search", createSearchRouter(opts.search));
    if (opts.emails) api.use("/emails", createEmailsRouter(opts.emails));
    api.use("/senders", createSendersRouter());
    if (slack) api.use("/slack", slack.authed);
    app.use("/api", api);
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
