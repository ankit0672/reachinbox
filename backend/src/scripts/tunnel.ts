// npm run tunnel: exposes the local API on your static ngrok domain, so
// Slack's OAuth redirect (which must be https) can reach it.
// Runs ngrok as its own foreground process in your terminal. It never reads,
// prints or passes the ngrok authtoken: the CLI loads it from its own config.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";

export class TunnelSetupError extends Error {}

export function ngrokArgs(env: { NGROK_DOMAIN?: string; API_PORT?: string }): string[] {
  const domain = (env.NGROK_DOMAIN ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!domain) {
    throw new TunnelSetupError(
      "NGROK_DOMAIN is not set in .env. Claim your free static domain at " +
        "https://dashboard.ngrok.com/domains and add e.g. NGROK_DOMAIN=your-name.ngrok-free.dev",
    );
  }
  const port = (env.API_PORT ?? "3001").trim();
  if (!/^\d+$/.test(port)) throw new TunnelSetupError(`API_PORT must be a number, got "${port}"`);
  return ["http", `--url=${domain}`, port];
}

function main() {
  const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
  // Only the two values we need; the rest of .env is irrelevant here.
  const parsed = dotenv.config({ path: rootEnv, quiet: true, processEnv: {} }).parsed ?? {};
  const args = ngrokArgs({
    NGROK_DOMAIN: process.env.NGROK_DOMAIN ?? parsed.NGROK_DOMAIN,
    API_PORT: process.env.API_PORT ?? parsed.API_PORT,
  });

  if (spawnSync("ngrok", ["version"], { stdio: "ignore" }).error) {
    throw new TunnelSetupError(
      "The ngrok CLI was not found on PATH. Install it (https://ngrok.com/download, or `yay -S ngrok` " +
        "on Arch), then run `ngrok config add-authtoken <token>` once.",
    );
  }

  console.log(`[tunnel] ngrok ${args.join(" ")}  ->  https://${args[1]!.slice("--url=".length)}`);
  const child = spawn("ngrok", args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`[tunnel] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
