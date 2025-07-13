import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchWeatherData, formatWeatherData } from "./lib/weather";

// Create MCP server instance
export function createMcpServer(env: CloudflareBindings) {
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
