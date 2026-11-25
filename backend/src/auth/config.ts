import { env } from "../config/env.js";

export interface GoogleConfig {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  /** Overridable so tests can point at a local fake Google. */
  authorizationURL?: string;
  tokenURL?: string;
  userProfileURL?: string;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  /** Fixed redirect target after login; never taken from the request. */
  frontendUrl: string;
  secureCookies: boolean;
  /** Undefined when Google credentials are not configured. */
  google?: GoogleConfig;
}

export function authConfigFromEnv(): AuthConfig {
  return {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresInSeconds: env.JWT_EXPIRES_IN,
    frontendUrl: env.FRONTEND_URL,
    secureCookies: env.NODE_ENV === "production",
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            clientID: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            callbackURL: env.GOOGLE_CALLBACK_URL,
          }
        : undefined,
  };
}
