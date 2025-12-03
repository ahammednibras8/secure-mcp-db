import { load } from "dotenv";

try {
  await load({ export: true, envPath: ".env.local" });
} catch {
  // Ignore if file doesn't exist (e.g. in production or if env vars are already set)
}
