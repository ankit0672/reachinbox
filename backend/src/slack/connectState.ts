import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

// The OAuth `state` for "Connect Slack". Slack redirects the browser to the
// tunnel/production host, where the login cookie may not exist, so the state
// itself carries the (signed) user id. It is purpose-tagged, expires in 10
// minutes and is single-use (its jti is burned in Redis on first use).
const PURPOSE = "slack-connect";

export function signConnectState(userId: string, secret: string): string {
  return jwt.sign({ purpose: PURPOSE }, secret, {
    subject: userId,
    jwtid: randomUUID(),
    expiresIn: 600,
    algorithm: "HS256",
  });
}

export function verifyConnectState(
  state: string,
  secret: string,
): { userId: string; jti: string } | null {
  try {
    const p = jwt.verify(state, secret, { algorithms: ["HS256"] });
    if (typeof p !== "object" || p.purpose !== PURPOSE || !p.sub || !p.jti) return null;
    return { userId: p.sub, jti: p.jti };
  } catch {
    return null;
  }
}
