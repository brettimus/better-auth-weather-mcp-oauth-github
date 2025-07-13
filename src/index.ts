import { StreamableHTTPTransport } from "@hono/mcp";
import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { Hono } from "hono";
import { html } from "hono/html";
import { readResourceCors, readWriteResourceCors } from "./cors";
import { createAuth, mcpAuthMiddleware } from "./lib/auth";
import { fetchWeatherData, formatWeatherData } from "./lib/weather";
import { createMcpServer } from "./mcp-server";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text(
    "Weather MCP Server - Use /mcp endpoint for MCP protocol communication",
  );
});

// Configure Better Auth routes
//
// OPTIONS + cors is necessary for auth from the mcp inspector
app.on(
  ["POST", "GET", "OPTIONS"],
  "/api/auth/**",
  readWriteResourceCors,
  (c) => {
    const auth = createAuth(c.env);
    return auth.handler(c.req.raw);
  },
);

// Set up the `/login` route that our mcp plugin will redirect to
app.get("/login", async (c) => {
  return c.html(
    html`
<html lang="en" >
  <head>
    <title>Login | Weather MCP with Auth</title>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script type="module">
      import { createAuthClient } from "https://esm.sh/better-auth@1.2.12/client";

      const authClient = createAuthClient();
      const data = await authClient.signIn.social({
        provider: "github"
      });
    </script>
  </body>
</html>
`,
  );
});

app.get("/logout", async (c) => {
  return c.html(
    html`
<html lang="en" >
  <head>
    <title>Login | Weather MCP with Auth</title>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script type="module">
      import { createAuthClient } from "https://esm.sh/better-auth@1.2.12/client";

      const authClient = createAuthClient();
      const data = await authClient.signOut();
    </script>
  </body>
</html>
`,
  );
});

app.get("/profile", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession(c.req.raw);
  return c.json({
    session,
  });
});

/**
 * Set up CORS for the authorization server metadata endpoint,
 * since the MCP inspector's Oauth flow debugger makes requests from a browser.
 */
app.all("/.well-known/oauth-authorization-server", readResourceCors);
/**
 * OAuth 2.0 Authorization Server Metadata endpoint (RFC 8414)
 *
 * @NOTE - Technically, Better Auth mounts `/api/auth/.well-known/oauth-authorization-server` and we could just proxy that somehow?
 */
app.get(
  "/.well-known/oauth-authorization-server",
  readResourceCors,
  async (c) => {
    const auth = createAuth(c.env);
    const metadataResponse = oAuthDiscoveryMetadata(auth)(c.req.raw);
    return metadataResponse;
  },
);

/**
 * Set up CORS for the protected resource metadata endpoint,
 * since the MCP inspector's Oauth flow debugger makes requests from a browser.
 */
app.all("/.well-known/oauth-protected-resource", readResourceCors);
/**
 * OAuth 2.0 Protected Resource Metadata endpoint (RFC 9728)
 * @NOTE - The Better Auth MCP plugin does not have routing for this at all, but the mcp inspector required it
 * @TODO - Check if this is part of the MCP spec
 * @TODO - Read RFC 9728 and see _how_ we should implement this
 */
app.get("/.well-known/oauth-protected-resource", async (c) => {
  const requestUrl = new URL(c.req.url);
  const resourceUrl = `${requestUrl.protocol}//${requestUrl.host}`;

  // Use the same issuer URL as the authorization server
  const authServerIssuer = resourceUrl; // This matches the "issuer" from our auth server metadata

  // TODO - Validate this metadata
  const metadata = {
    resource: resourceUrl,
    authorization_servers: [authServerIssuer],
    scopes_supported: [
      "openid",
      "profile",
      "email",
      // NOTE - To support offline access, we would need to add a consent screen
      //        and clients would have to add the `prompt=consent` parameter to the
      //        authorization request.
      //
      // "offline_access",
      // "weather:read"
    ],
    bearer_methods_supported: ["header"],
    resource_name: "Weather MCP Server",
    // Additional metadata that we don't need to implement yet:
    //
    // resource_documentation: `${resourceUrl}/docs`,
    // resource_policy_uri: `${resourceUrl}/docs/policy`,
    // resource_tos_uri: `${resourceUrl}/docs/tos`,
  };

  return c.json(metadata);
});

// MCP protocol endpoint
app.all("/mcp", readWriteResourceCors, mcpAuthMiddleware, async (c) => {
  const mcpServer = createMcpServer(c.env);
  const transport = new StreamableHTTPTransport();

  await mcpServer.connect(transport);
  return transport.handleRequest(c);
});

// Test endpoint for direct weather API access (for debugging)
app.get("/api/weather/:location", async (c) => {
  const location = c.req.param("location");

  if (!location) {
    return c.json({ error: "Location parameter is required" }, 400);
  }

  try {
    const weatherData = await fetchWeatherData(
      location,
      c.env.OPENWEATHER_API_KEY,
    );
    const formattedData = formatWeatherData(weatherData);

    return c.json({
      location,
      data: JSON.parse(formattedData),
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        location,
      },
      400,
    );
  }
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    service: "weather-mcp-server",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

export default app;
