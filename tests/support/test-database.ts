import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type TestDatabase = PGlite;

export async function createTestDatabase(): Promise<TestDatabase> {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;
  await installSupabaseTestCompatibility(database);
  await applyMigrations(database);
  return database;
}

async function installSupabaseTestCompatibility(database: TestDatabase) {
  const bootstrapPath = path.join(
    process.cwd(),
    "tests",
    "support",
    "supabase-test-bootstrap.sql",
  );
  await database.exec(await readFile(bootstrapPath, "utf8"));
}

async function applyMigrations(database: TestDatabase) {
  const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const migrationFile of migrationFiles) {
    const sql = await readFile(path.join(migrationsDirectory, migrationFile), "utf8");
    await database.exec(sql);
  }
}
