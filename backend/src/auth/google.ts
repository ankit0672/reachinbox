import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { prisma } from "../db/prisma.js";
import type { GoogleConfig } from "./config.js";

export interface GoogleUserInput {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Creates the user on first login and refreshes name, email and avatar on
 * every login. Two simultaneous first logins for the same Google account can
 * both try the insert; the loser gets P2002 and reads the winner's row.
 */
export async function upsertGoogleUser(input: GoogleUserInput) {
  const profile = { email: input.email, name: input.name, avatarUrl: input.avatarUrl };
  try {
    return await prisma.user.upsert({
      where: { googleId: input.googleId },
      update: profile,
      create: { googleId: input.googleId, ...profile },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;
    return prisma.user.findUniqueOrThrow({ where: { googleId: input.googleId } });
  }
}

export function profileToUser(profile: Profile): GoogleUserInput | null {
  const email = profile.emails?.[0]?.value?.trim().toLowerCase();
  if (!email) return null;
  return {
    googleId: profile.id,
    email,
    name: profile.displayName || email,
    avatarUrl: profile.photos?.[0]?.value ?? null,
  };
}

export function createGoogleStrategy(config: GoogleConfig): GoogleStrategy {
  return new GoogleStrategy(
    {
      clientID: config.clientID,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackURL,
      ...(config.authorizationURL ? { authorizationURL: config.authorizationURL } : {}),
      ...(config.tokenURL ? { tokenURL: config.tokenURL } : {}),
      ...(config.userProfileURL ? { userProfileURL: config.userProfileURL } : {}),
    },
    (_accessToken, _refreshToken, profile, done) => {
      const input = profileToUser(profile);
      if (!input) return done(null, false);
      upsertGoogleUser(input)
        .then((user) => done(null, { id: user.id, email: user.email, name: user.name }))
        .catch((err) => done(err));
    },
  );
}
