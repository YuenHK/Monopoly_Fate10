import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export async function openDatabase({ dataDir, databaseUrl }) {
  if (!databaseUrl) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(resolve(dataDir, 'monopoly.sqlite'));
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    return {
      postgres: false,
      exec: async sql => db.exec(sql),
      all: async (sql, ...args) => db.prepare(sql).all(...args),
      get: async (sql, ...args) => db.prepare(sql).get(...args),
      run: async (sql, ...args) => db.prepare(sql).run(...args),
      close: async () => db.close()
    };
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('資料庫連線中斷，下一次請求會重新連線'));
  let client = null;
  const sqlParams = sql => { let index = 0; return sql.replace(/\?/g, () => '$' + (++index)); };
  const query = (sql, args = []) => (client || pool).query(sqlParams(sql), args);
  return {
    postgres: true,
    async exec(sql) {
      if (sql === 'BEGIN IMMEDIATE') {
        client = await pool.connect();
        try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(724103)'); }
        catch (error) { client.release(true); client = null; throw error; }
      } else if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        try { await client.query(sql); } finally { client.release(); client = null; }
      } else await query(sql);
    },
    all: async (sql, ...args) => (await query(sql, args)).rows,
    get: async (sql, ...args) => (await query(sql, args)).rows[0],
    run: async (sql, ...args) => query(sql, args),
    close: () => pool.end()
  };
}
