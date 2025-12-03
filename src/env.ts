import { load } from "dotenv";

try {
  await load({ export: true, envPath: ".env.local" });
} catch (error) {
  console.error("Error loading .env.local:", error);
}
