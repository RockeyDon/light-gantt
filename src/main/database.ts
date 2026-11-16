import Database from 'better-sqlite3';

export function openDatabase(filename: string): Database.Database {
  const db = new Database(filename);
  try {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > 2) throw new Error('数据库版本高于此应用支持的版本，请使用较新的轻甘特');
    if (version === 1) throw new Error('开发数据库结构已更新，请关闭应用并删除旧的 gantt.sqlite、gantt.sqlite-wal 和 gantt.sqlite-shm 后重启');
    db.pragma('foreign_keys = ON');
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
          CREATE TABLE settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            llm_base_url TEXT NOT NULL DEFAULT '',
            llm_api_key BLOB,
            llm_model_id TEXT NOT NULL DEFAULT '',
            theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark'))
          );
          INSERT INTO settings (id) VALUES (1);
          PRAGMA user_version = 2;
        `);
      })();
    }
    // Development schema: add daily progress directly to both existing and new databases.
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_progress (
        task_id TEXT NOT NULL REFERENCES gantt(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        content TEXT NOT NULL CHECK (length(trim(content)) > 0),
        PRIMARY KEY (task_id, date)
      );
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
