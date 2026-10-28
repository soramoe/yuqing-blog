import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./src/lib/auth-schema.ts",
    "./src/lib/comment-schema.ts",
    "./src/lib/points-schema.ts",
  ],
  out: "./migrations",
});
