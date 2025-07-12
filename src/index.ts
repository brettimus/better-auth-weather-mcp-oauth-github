import { createFiberplane, createOpenAPISpec } from "@fiberplane/hono";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// OpenWeather API response interface
interface WeatherResponse {
  coord: {
    lon: number;
    lat: number;
  };
  weather: Array<{
    id: number;
    main: string;
    description: string;
    icon: string;
  }>;
  base: string;
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    pressure: number;
    humidity: number;
  };
  visibility: number;
  wind: {
    speed: number;
    deg: number;
  };
  clouds: {
    all: number;
  };
  dt: number;
  sys: {
    type: number;
    id: number;
    country: string;
    sunrise: number;
    sunset: number;
  };
  timezone: number;
  id: number;
  name: string;
  cod: number;
}

// Function to fetch weather data from OpenWeather API
async function fetchWeatherData(location: string, apiKey: string): Promise<WeatherResponse> {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=metric`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Location "${location}" not found`);
    }
    if (response.status === 401) {
      throw new Error('Invalid OpenWeather API key');
    }
    if (response.status === 429) {
      throw new Error('OpenWeather API rate limit exceeded');
    }
    throw new Error(`OpenWeather API error: ${response.status}`);
  }

  return await response.json();
}

// Function to format weather data for MCP response
function formatWeatherData(data: WeatherResponse): string {
  const weather = data.weather[0];
  const main = data.main;
  const wind = data.wind;
  
  return JSON.stringify({
    location: {
      name: data.name,
      country: data.sys.country,
      coordinates: {
        latitude: data.coord.lat,
        longitude: data.coord.lon
      }
    },
    current: {
      temperature: {
        current: Math.round(main.temp),
        feels_like: Math.round(main.feels_like),
        min: Math.round(main.temp_min),
        max: Math.round(main.temp_max),
        unit: "°C"
      },
      conditions: {
        main: weather.main,
        description: weather.description
      },
      humidity: main.pressure,
      wind: {
        speed: wind.speed,
        direction: wind.deg,
        unit: "m/s"
      },
      pressure: main.pressure,
      visibility: data.visibility,
      timestamp: new Date(data.dt * 1000).toISOString()
    }
  }, null, 2);
}

// Create MCP server instance
function createMcpServer(env: CloudflareBindings) {
  const server = new McpServer({ 
    name: "weather-mcp-server", 
    version: "1.0.0",
    description: "MCP server providing current weather data for any location"
  });

  // Register the get_current_weather tool
  server.tool(
    "get_current_weather",
    {
      location: z.string().min(1).describe("City name, state/country (e.g., 'London, UK' or 'New York, NY')")
    },
    async ({ location }) => {
      try {
        const weatherData = await fetchWeatherData(location, env.OPENWEATHER_API_KEY);
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
    }
  );

  return server;
}

app.get("/", (c) => {
  return c.text("Weather MCP Server - Use /mcp endpoint for MCP protocol communication");
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ 
    status: "healthy", 
    service: "weather-mcp-server",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

// MCP protocol endpoint
app.all("/mcp", async (c) => {
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
    const weatherData = await fetchWeatherData(location, c.env.OPENWEATHER_API_KEY);
    const formattedData = formatWeatherData(weatherData);
    
    return c.json({
      location,
      data: JSON.parse(formattedData)
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : "Unknown error",
      location
    }, 400);
  }
});

/**
 * Serve a simplified api specification for your API
 * As of writing, this is just the list of routes and their methods.
 */
app.get("/openapi.json", c => {
  return c.json(createOpenAPISpec(app, {
    info: {
      title: "Weather MCP Server",
      version: "1.0.0",
      description: "Model Context Protocol server providing weather data functionality"
    },
  }))
});

/**
 * Mount the Fiberplane api explorer to be able to make requests against your API.
 *
 * Visit the explorer at `/fp`
 */
app.use("/fp/*", createFiberplane({
  app,
  openapi: { url: "/openapi.json" }
}));

export default app;