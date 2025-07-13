import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { createAuth, withMcpAuth } from "./lib/auth";
import { fetchWeatherData, formatWeatherData } from "./lib/weather";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Create MCP server instance
function createMcpServer(env: CloudflareBindings) {
  const server = new McpServer({
    name: "weather-mcp-server",
    version: "1.0.0",
    description: "MCP server providing current weather data for any location",
  });

  // Register the get_current_weather tool
  server.tool(
    "get_current_weather",
    {
      location: z
        .string()
        .min(1)
        .describe(
          "City name, state/country (e.g., 'London, UK' or 'New York, NY')",
        ),
    },
    async ({ location }) => {
      try {
        const weatherData = await fetchWeatherData(
          location,
          env.OPENWEATHER_API_KEY,
        );
        const formattedData = formatWeatherData(weatherData);

        return {
          content: [
            {
              type: "text",
              text: formattedData,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error fetching weather data: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

app.get("/", (c) => {
  return c.text(
    "Weather MCP Server - Use /mcp endpoint for MCP protocol communication",
  );
});

// OPTIONS + cors is necessary for auth from the mcp inspector
app.on(
  ["POST", "GET", "OPTIONS"],
  "/api/auth/**",
  cors({
    origin: "*", // Liberal CORS for MCP clients from any origin
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: false, // Set to false when using origin: "*"
  }),
  (c) => {
    const auth = createAuth(c.env);
    return auth.handler(c.req.raw);
  },
);

app.get("/login", async (c) => {
  console.log("login", c.req.raw.url);
  const auth = createAuth(c.env);
  // Tell BA where to come back after GitHub ↩︎
  const callbackURL = `${new URL(c.req.url).origin}/api/auth/callback/github`;
  const errorCallback = `${new URL(c.req.url).origin}/login/error`;

  // Server-side helper: turns our GET into the POST body signIn.social expects
  // HACK - replicating logic from github oauth provider...
  const { url } = await auth.api.signInSocial({
    body: {
      provider: "github",
      callbackURL,
      errorCallbackURL: errorCallback,
      scopes: ["read:user", "user:email"],
    },

    // Forward cookies so Better Auth can keep its CSRF + state data
    headers: { cookie: c.req.header("cookie") ?? "" },
  });

  if (!url) {
    return c.json({ error: "Failed to redirect to GitHub" }, 500);
  }

  // signIn.social replies  { redirect:true, url:"https://github.com/..." }
  return c.redirect(url);
});

app.all(
  "/.well-known/oauth-authorization-server",
  cors({
    origin: "*", // Liberal CORS for MCP clients from any origin
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: false, // Set to false when using origin: "*"
  }),
);
app.get("/.well-known/oauth-authorization-server", async (c) => {
  const auth = createAuth(c.env);
  const metadataResponse = oAuthDiscoveryMetadata(auth)(c.req.raw);
  return metadataResponse;
});

// OAuth 2.0 Protected Resource Metadata endpoint (RFC 9728)
app.all(
  "/.well-known/oauth-protected-resource",
  cors({
    origin: "*", // Liberal CORS for MCP clients from any origin
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: false, // Set to false when using origin: "*"
  }),
);
app.get("/.well-known/oauth-protected-resource", async (c) => {
  const requestUrl = new URL(c.req.url);
  const resourceUrl = `${requestUrl.protocol}//${requestUrl.host}`;

  // Use the same issuer URL as the authorization server
  const authServerIssuer = resourceUrl; // This matches the "issuer" from your auth server metadata

  const metadata = {
    resource: resourceUrl,
    authorization_servers: [authServerIssuer],
    scopes_supported: [
      "openid",
      "profile",
      "email",
      // "offline_access",
      // "weather:read"
    ],
    bearer_methods_supported: ["header"],
    resource_name: "Weather MCP Server",
    resource_documentation: `${resourceUrl}/fp`,
    resource_policy_uri: `${resourceUrl}/fp`,
    resource_tos_uri: `${resourceUrl}/fp`,
  };

  return c.json(metadata);
});

// MCP protocol endpoint
app.all(
  "/mcp",
  cors({
    origin: "*", // Liberal CORS for MCP clients from any origin
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: false, // Set to false when using origin: "*"
  }),
  async (c) => {
    const auth = createAuth(c.env);
    const res = await withMcpAuth(auth, c.req.raw);
    if (res) {
      return res;
    }

    const mcpServer = createMcpServer(c.env);
    const transport = new StreamableHTTPTransport();

    await mcpServer.connect(transport);
    return transport.handleRequest(c);
  },
);

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
