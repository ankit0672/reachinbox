import { Router } from "express";
import { z } from "zod";
import { describeError } from "../lib/describeError.js";
import type { EmailIndex } from "../search/emailIndex.js";

export interface SearchDeps {
  index: EmailIndex;
  maxPageSize: number;
}

// Elasticsearch's default max_result_window.
const MAX_WINDOW = 10_000;

export function createSearchRouter(deps: SearchDeps): Router {
  const router = Router();
  const schema = z
    .object({
      q: z.string().trim().max(200).optional(),
      status: z.enum(["scheduled", "sent", "failed"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(deps.maxPageSize).default(20),
    })
    .refine((p) => p.page * p.pageSize <= MAX_WINDOW, {
      path: ["page"],
      message: `page * pageSize must be at most ${MAX_WINDOW}`,
    });

  router.get("/", async (req, res) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { q, status, page, pageSize } = parsed.data;
    try {
      const { total, results } = await deps.index.search({
        userId: req.user!.id, // scoping comes from auth, never from the query string
        q: q || undefined,
        status,
        page,
        pageSize,
      });
      res.json({ total, page, pageSize, results });
    } catch (err) {
      console.error(`[search] query failed: ${describeError(err)}`);
      res.status(503).json({ error: "Search is temporarily unavailable" });
    }
  });

  return router;
}
