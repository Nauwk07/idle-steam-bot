import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function initDatabase(connectionString: string) {
  _pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  _db = drizzle(_pool, { schema });
  return _db;
}

export function getDb() {
  if (!_db) throw new Error("DB non initialisée — appelle initDatabase() d'abord");
  return _db;
}

export function closeDatabase() {
  return _pool?.end();
}

export { schema };
