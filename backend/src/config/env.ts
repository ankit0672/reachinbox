import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { parseEnv } from "./envSchema.js";

// One .env at the repo root feeds both docker compose and the backend.
// Real environment variables win over the file (dotenv never overrides).
const rootEnvFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
dotenv.config({ path: rootEnvFile, quiet: true });

export const env = parseEnv(process.env);
