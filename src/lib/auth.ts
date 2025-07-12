import { betterAuth } from "better-auth";
// import type { GithubProfile } from "better-auth/social-providers";
// import { decodeJwt } from "jose";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
// import { eq } from "drizzle-orm";
import { account, session, user, verification } from "../db/schema";

interface Env {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  DB: D1Database;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export const createAuth = (env: Env) => {
  const db = drizzle(env.DB);

  return betterAuth({
    user: {
      additionalFields: {
        githubUsername: {
          type: "string", // Match the type in your database
          required: false, // Or true, if every user must have it
        },
      },
    },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: user,
        session: session,
        account: account,
        verification: verification,
      },
    }),
    emailAndPassword: {
      enabled: false, // Disable email/password auth, only OAuth
    },
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    advanced: {
      cookiePrefix: "some-fixed-random-prefix-123",
    },
    logger: {
      level: "debug", // Options: "error", "warn", "info", "debug"
      log: (level, message, ...args) => {
        console.log(`[BetterAuth][${level}]`, message, ...args);
      },
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;
