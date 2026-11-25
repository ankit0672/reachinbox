import type { Response } from "supertest";
import type { AuthConfig } from "../../src/auth/config.js";
import { SESSION_COOKIE, signSession } from "../../src/auth/session.js";
import { prisma } from "../../src/db/prisma.js";

// Fixed test secret: tests never depend on the developer's real JWT_SECRET.
export const TEST_JWT_SECRET = "test-only-secret-0123456789abcdef0123456789";

export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    jwtSecret: TEST_JWT_SECRET,
    jwtExpiresInSeconds: 3600,
    frontendUrl: "http://localhost:5173",
    secureCookies: false,
    ...overrides,
  };
}

/** Creates (or reuses) a user and returns a real signed session cookie for it. */
export async function loginAs(email: string, config: AuthConfig = testAuthConfig()) {
  const user = await prisma.user.upsert({
    where: { googleId: `test:${email}` },
    update: {},
    create: { googleId: `test:${email}`, email, name: email.split("@")[0]! },
  });
  return { user, cookie: `${SESSION_COOKIE}=${signSession(user.id, config)}` };
}

/** The raw Set-Cookie line for `name` from a response, if any. */
export function setCookie(res: Response, name: string): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

/** "name=value" (no attributes) from a Set-Cookie line, ready to send back. */
export const cookiePair = (line: string | undefined) => line?.split(";")[0] ?? "";
