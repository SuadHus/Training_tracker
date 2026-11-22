import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const processGlobal = globalThis as typeof globalThis & { trainingPool?: Pool };

function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  processGlobal.trainingPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  return processGlobal.trainingPool;
}

export function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return database().query<T>(sql, params);
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
