import Database from 'better-sqlite3';

export function openDatabase(filename: string): Database.Database {
  const db = new Database(filename);
  try {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > 1) throw new Error('数据库版本高于此应用支持的版本，请使用较新的轻甘特');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    if (version === 0) {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE gantt (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL CHECK (length(trim(name)) > 0),
            start_time TEXT NOT NULL,
            end_time TEXT,
            assign TEXT NOT NULL DEFAULT '',
            is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
            CHECK (end_time IS NULL OR end_time >= start_time)
          );
          CREATE INDEX idx_gantt_done_start ON gantt (is_done, start_time);
          PRAGMA user_version = 1;
        `);
      })();
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
