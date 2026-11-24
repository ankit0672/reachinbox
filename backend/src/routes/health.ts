import { Router } from "express";

export type HealthCheck = () => Promise<unknown>;
export type HealthChecks = Record<string, HealthCheck>;

type CheckResult = { status: "ok" } | { status: "down"; error: string };

function withTimeout(check: HealthCheck, timeoutMs: number): Promise<unknown> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([check(), timeout]).finally(() => clearTimeout(timer));
}

async function runCheck(check: HealthCheck, timeoutMs: number): Promise<CheckResult> {
  try {
    await withTimeout(check, timeoutMs);
    return { status: "ok" };
  } catch (err) {
    return { status: "down", error: err instanceof Error ? err.message : String(err) };
  }
}

export function createHealthRouter(checks: HealthChecks, timeoutMs = 3000): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const entries = await Promise.all(
      Object.entries(checks).map(
        async ([name, check]) => [name, await runCheck(check, timeoutMs)] as const,
      ),
    );
    const allOk = entries.every(([, result]) => result.status === "ok");

    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ok" : "degraded",
      checks: Object.fromEntries(entries),
    });
  });

  return router;
}
