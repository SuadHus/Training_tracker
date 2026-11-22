import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

export const databaseUrl = process.env.TEST_DATABASE_URL;

export const schemaSql = readFileSync(join(__dirname, "../db/schema.sql"), "utf8");
export const legacySql = readFileSync(join(__dirname, "fixtures/legacy.sql"), "utf8");

/**
 * A schema of its own inside the test database, so test files can run side by side.
 * The files in db/ contain BEGIN and COMMIT, so `run` sends them over the simple query protocol.
 */
export async function isolatedSchema(base: string) {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${name}`);
  const url = `${base}${base.includes("?") ? "&" : "?"}options=-c%20search_path%3D${name}`;

  const connect = async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    return client;
  };

  return {
    name,
    url,
    async run(sql: string) {
      const client = await connect();
      try {
        await client.query(sql);
      } finally {
        await client.end();
      }
    },
    async rows<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const client = await connect();
      try {
        return (await client.query(sql, params)).rows as T[];
      } finally {
        await client.end();
      }
    },
    async drop() {
      await admin.query(`DROP SCHEMA ${name} CASCADE`);
      await admin.end();
    },
  };
}
