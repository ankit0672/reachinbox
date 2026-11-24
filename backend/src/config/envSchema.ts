import { z } from "zod";

// Pure schema, no dotenv/process access, so it can be unit tested.
// Variables are added here milestone by milestone as code starts using them;
// .env.example already lists the later ones (limits, Google, Slack, ...).
const schema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  ELASTICSEARCH_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.url().default("http://localhost:5173"),
  SENDER_POOL_SIZE: z.coerce.number().int().positive().default(3),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${problems}`);
}
