import { defineConfig } from "drizzle-kit";
import { loadEnv } from "vite";

const fileEnv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL
      ?? fileEnv.DATABASE_URL
      ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
