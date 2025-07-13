import type { WeatherResponse } from "../types";

// Function to fetch weather data from OpenWeather API
export async function fetchWeatherData(
  location: string,
  apiKey: string,
): Promise<WeatherResponse> {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=metric`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Location "${location}" not found`);
    }
    if (response.status === 401) {
      throw new Error("Invalid OpenWeather API key");
    }
    if (response.status === 429) {
      throw new Error("OpenWeather API rate limit exceeded");
    }
    throw new Error(`OpenWeather API error: ${response.status}`);
  }

  return await response.json();
}

// Function to format weather data for MCP response
export function formatWeatherData(data: WeatherResponse): string {
  const weather = data.weather[0];
  const main = data.main;
  const wind = data.wind;

  return JSON.stringify(
    {
      location: {
        name: data.name,
        country: data.sys.country,
        coordinates: {
          latitude: data.coord.lat,
          longitude: data.coord.lon,
        },
      },
      current: {
        temperature: {
          current: Math.round(main.temp),
          feels_like: Math.round(main.feels_like),
          min: Math.round(main.temp_min),
          max: Math.round(main.temp_max),
          unit: "°C",
        },
        conditions: {
          main: weather.main,
          description: weather.description,
        },
        humidity: main.pressure,
        wind: {
          speed: wind.speed,
          direction: wind.deg,
          unit: "m/s",
        },
        pressure: main.pressure,
        visibility: data.visibility,
        timestamp: new Date(data.dt * 1000).toISOString(),
      },
    },
    null,
    2,
  );
}
