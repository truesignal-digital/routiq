import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function globalSetup(project: TestProject) {
  /**
   * Escape hatch for environments without a Docker daemon (e.g. Claude Code on
   * the web): point the suite at an already-running Postgres instead of a
   * Testcontainers one. Migrations still run; the suite creates workspaces per
   * test, so the database only needs to exist and be owned by the given user.
   * CI and local dev keep the containerized default.
   */
  const externalUrl = process.env["ROUTIQ_TEST_DATABASE_URL"];
  const container = externalUrl
    ? undefined
    : await new PostgreSqlContainer("postgres:17-alpine").start();
  const databaseUrl = externalUrl ?? container!.getConnectionUri();

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
  } finally {
    await pool.end();
  }

  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await container?.stop();
  };
}
