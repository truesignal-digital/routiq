import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgres://asset:asset@localhost:5433/asset_dev",
  },
});
