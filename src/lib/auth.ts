import { betterAuth } from "better-auth";
// import type { GithubProfile } from "better-auth/social-providers";
// import { decodeJwt } from "jose";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mcp as mcpAuthPlugin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
// import { eq } from "drizzle-orm";
import {
  account,
  oauthAccessToken,
  oauthApplication,
  session,
  user,
  verification,
} from "../db/schema";

export const createAuth = (env: CloudflareBindings) => {
  const db = drizzle(env.DB);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: user,
        session: session,
        account: account,
        verification: verification,
        oauthApplication: oauthApplication,
        oauthAccessToken: oauthAccessToken,
      },
    }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
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
    // TODO - No cookies? IDK?
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

export async function withMcpAuth(auth: Auth, req: Request) {
  const session = await auth.api.getMcpSession({
    headers: req.headers,
  });
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const wwwAuthenticateValue = `Bearer resource_metadata=${baseUrl}/api/auth/.well-known/oauth-authorization-server`;
  if (!session) {
    return Response.json(
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
}
