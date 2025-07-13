import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";

export const readResourceCors = createMiddleware<{
  Bindings: CloudflareBindings;
}>((c, next) => {
  if (c.env.CORS_ENVIRONMENT === "local") {
    return cors({
      origin: "*", // Liberal CORS for MCP clients from any origin
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: false, // Set to false when using origin: "*"
    })(c, next);
  }

  return next();
});

export const readWriteResourceCors = createMiddleware<{
  Bindings: CloudflareBindings;
}>((c, next) => {
  if (c.env.CORS_ENVIRONMENT === "local") {
    return cors({
      origin: "*", // Liberal CORS for MCP clients from any origin
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: false, // Set to false when using origin: "*"
    })(c, next);
  }

  return next();
});
