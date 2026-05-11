import type { DatabaseConnection } from "./database";

export type GameRecord = {
  appId: number;
  name: string | null;
  enabled: boolean;
  addedAt: string;
  updatedAt: string;
};

export type IdleEventRecord = {
  id: number;
  level: string;
  message: string;
  meta: string | null;
  createdAt: string;
};

type GameRow = {
  app_id: number;
  name: string | null;
  enabled: number;
  added_at: string;
  updated_at: string;
};

type IdleEventRow = {
  id: number;
  level: string;
  message: string;
  meta: string | null;
  created_at: string;
};

const DEFAULT_SETTINGS = {
  auto_restart: "true",
  dry_run: "false",
  standby: "false",
};

export class GamesRepository {
  constructor(private readonly db: DatabaseConnection) {}

  upsert(appId: number, name?: string) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO games (app_id, name, enabled, added_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(app_id) DO UPDATE SET
          name = COALESCE(excluded.name, games.name),
          enabled = 1,
          updated_at = excluded.updated_at
      `,
      )
      .run(appId, name || null, now, now);
  }

  remove(appId: number) {
    const result = this.db.prepare("DELETE FROM games WHERE app_id = ?").run(appId);
    if (Number(result.changes) === 0) {
      throw new Error(`Jeu introuvable: ${appId}`);
    }
  }

  updateName(appId: number, name: string) {
    this.db
      .prepare("UPDATE games SET name = ?, updated_at = ? WHERE app_id = ?")
      .run(name, new Date().toISOString(), appId);
  }

  list(includeDisabled = true): GameRecord[] {
    const where = includeDisabled ? "" : "WHERE enabled = 1";
    const rows = this.db
      .prepare(`SELECT * FROM games ${where} ORDER BY enabled DESC, app_id ASC`)
      .all() as GameRow[];
    return rows.map(mapGame);
  }

  enabledAppIds(): number[] {
    return this.list(false).map((game) => game.appId);
  }

  countEnabled(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM games WHERE enabled = 1")
      .get() as { count: number };
    return row.count;
  }
}

export class SettingsRepository {
  constructor(private readonly db: DatabaseConnection) {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      this.db
        .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
        .run(key, value);
    }
  }

  get(key: string, fallback = ""): string {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? fallback;
  }

  set(key: string, value: string | boolean | number) {
    this.db
      .prepare(
        `
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      )
      .run(key, String(value));
  }

  getBoolean(key: string, fallback = false): boolean {
    const value = this.get(key, String(fallback)).toLowerCase();
    return ["1", "true", "yes", "on"].includes(value);
  }

  setBoolean(key: string, value: boolean) {
    this.set(key, value ? "true" : "false");
  }
}

export class EventLogRepository {
  constructor(private readonly db: DatabaseConnection) {}

  add(level: string, message: string, meta?: unknown) {
    this.db
      .prepare(
        `
        INSERT INTO idle_events (level, message, meta, created_at)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(
        level,
        message,
        meta === undefined ? null : JSON.stringify(meta),
        new Date().toISOString(),
      );
  }

  recent(limit: number): IdleEventRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM idle_events
        ORDER BY id DESC
        LIMIT ?
      `,
      )
      .all(Math.max(1, Math.min(limit, 50))) as IdleEventRow[];
    return rows.map((row) => ({
      id: row.id,
      level: row.level,
      message: row.message,
      meta: row.meta,
      createdAt: row.created_at,
    }));
  }
}

function mapGame(row: GameRow): GameRecord {
  return {
    appId: row.app_id,
    name: row.name,
    enabled: row.enabled === 1,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  };
}
