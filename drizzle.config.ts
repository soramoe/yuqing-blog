import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./src/lib/auth-schema.ts",
    "./src/lib/comment-schema.ts",
    "./src/lib/points-schema.ts",
    "./src/lib/shop-schema.ts",
    "./src/lib/gallery-upload-schema.ts",
    "./src/lib/account-binding-schema.ts",
    "./src/lib/story-settings-schema.ts",
  ],
  out: "./migrations",
});
