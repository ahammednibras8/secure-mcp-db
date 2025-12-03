import { load } from "dotenv";

try {
  await load({ export: true, envPath: ".env.local" });
} catch (error) {
  if (error instanceof Deno.errors.NotFound) {
    // Ignore if file doesn't exist (e.g. in Docker)
  } else {
    console.error("Error loading .env.local:", error);
  }
}
