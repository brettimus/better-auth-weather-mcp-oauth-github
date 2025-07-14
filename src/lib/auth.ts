import { betterAuth } from "better-auth";
// import type { GithubProfile } from "better-auth/social-providers";
// import { decodeJwt } from "jose";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mcp as mcpAuthPlugin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
// import { eq } from "drizzle-orm";
import {
  account,
  oauthAccessToken,
  oauthApplication,
  session,
  user,
  verification,
} from "../db/schema";

/**
 * Create a Better Auth instance.
 * - Has a `socialProviders` config for GitHub
 * - Has a `plugins` config for the MCP plugin, which redirects to the `/login` route
 * - Disables email/password auth
 *
 * @TODO - Determine the proper cookie prefix, if any
 * @TODO - Investigate usage of OIDC consent screen
 */
export const createAuth = (env: CloudflareBindings) => {
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
        /**
         * @NOTE - We need these additional fields to support the MCP plugin
         *
         * It would probably be smarted to `import * as authSchema from "../db/auth";`,
         * then we can just pass `authSchema` to the `drizzleAdapter` config.
         */
        verification: verification,
        oauthApplication: oauthApplication,
        oauthAccessToken: oauthAccessToken,
      },
    }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        mapProfileToUser: (profile) => {
          return {
            githubUsername: profile.login, // Map GitHub login to our custom field
          };
        },
      },
    },
    plugins: [
      mcpAuthPlugin({
        loginPage: "/login",
        // oidcConfig: {
        //   /**
        //    * A URL to the consent page where the user will be redirected if the client
        //    * requests consent.
        //    *
        //    * After the user consents, they should be redirected by the client to the
        //    * `redirect_uri` with the authorization code.
        //    *
        //    * When the server redirects the user to the consent page, it will include the
        //    * following query parameters:
        //    * authorization code.
        //    * - `client_id` - The ID of the client.
        //    * - `scope` - The requested scopes.
        //    * - `code` - The authorization code.
        //    *
        //    * once the user consents, you need to call the `/oauth2/consent` endpoint
        //    * with the code and `accept: true` to complete the authorization. Which will
        //    * then return the client to the `redirect_uri` with the authorization code.
        //    *
        //    * @example
        //    * ```ts
        //    * consentPage: "/oauth/authorize"
        //    * ```
        //    */
        //   consentPage?: string;
        //   /**
        //    * The HTML for the consent page. This is used if `consentPage` is not
        //    * provided. This should be a function that returns an HTML string.
        //    * The function will be called with the following props:
        //    */
        //   getConsentHTML?: (props: {
        //     clientId: string;
        //     clientName: string;
        //     clientIcon?: string;
        //     clientMetadata: Record<string, any> | null;
        //     code: string;
        //     scopes: string[];
        //   }) => string;
        // }
      }),
    ],
    emailAndPassword: {
      enabled: false, // Disable email/password auth, only OAuth
    },
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    advanced: {
      cookiePrefix: "wmcp",
    },
    logger: {
      level: "debug", // Options: "error", "warn", "info", "debug"
      log: (level, message, ...args) => {
        const serializedArgs = args.map((arg) => {
          if (typeof arg === "object" && arg !== null) {
            try {
              // Create a Set to track visited objects and prevent circular references
              const seen = new WeakSet();
              return JSON.stringify(
                arg,
                (_key, value) => {
                  if (typeof value === "object" && value !== null) {
                    if (seen.has(value)) {
                      return "[Circular Reference]";
                    }
                    seen.add(value);
                  }
                  return value;
                },
                2,
              );
            } catch (error) {
              return `[Object serialization failed: ${error instanceof Error ? error.message : "Unknown error"}]`;
            }
          }
          return arg;
        });
        console.log(`[BetterAuth][${level}]`, message, ...serializedArgs);
      },
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;

/**
 * Middleware to check if the MCP session is valid.
 *
 * @NOTE - This is a re-implementation of `withMcpAuth` from the Better Auth MCP plugin,
 *         since that function is not very Hono-y, and is better suited to use in a Next.js app.
 *
 * @NOTE - We would have to re-implement this anyhow (I think) since the Better Auth `withMcpAuth` helper
 *         uses the host `http://localhost:3000` in the wwwAuthenticate value, which felt very incorrect.
 *         @see: https://github.com/better-auth/better-auth/blob/7835167b8278c88dccbdfdf49ed987efe2811afd/packages/better-auth/src/plugins/mcp/index.ts
 */
export const mcpAuthMiddleware = createMiddleware<{
  Bindings: CloudflareBindings;
}>(async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getMcpSession({
    headers: c.req.raw.headers,
  });
  const url = new URL(c.req.raw.url);
  // TODO - Check if this construction is correct
  const baseUrl = `${url.protocol}//${url.host}`;
  const wwwAuthenticateValue = `Bearer resource_metadata=${baseUrl}/api/auth/.well-known/oauth-authorization-server`;

  if (!session) {
    return c.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Unauthorized: Authentication required",
          "www-authenticate": wwwAuthenticateValue,
        },
        id: null,
      },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": wwwAuthenticateValue,
        },
      },
    );
  }
  console.log("session", session.userId);
  return next();
});
