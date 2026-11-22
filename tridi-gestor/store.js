/* TRIDI MX · Gestor — almacenamiento SQLite (node:sqlite, incluido en Node 22)
   - kv: una fila por colección (db:clientes, db:presupuestos, users, notifs, prod:jobs…)
   - sessions: sesiones persistentes (un deploy ya no cierra la sesión de nadie)
   - respaldo diario con VACUUM INTO (30 días)                                          */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

module.exports = function openStore(DATA_DIR) {
  const file = path.join(DATA_DIR, 'tridi.db');
  const sql = new DatabaseSync(file);
  sql.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, username TEXT NOT NULL, exp INTEGER NOT NULL);`);
  const qGet = sql.prepare('SELECT v FROM kv WHERE k = ?');
  const qPut = sql.prepare('INSERT INTO kv (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated');
  const qPrefix = sql.prepare('SELECT k, v FROM kv WHERE substr(k, 1, ?) = ?');
  const qCount = sql.prepare('SELECT COUNT(*) AS n FROM kv');
  const sPut = sql.prepare('INSERT OR REPLACE INTO sessions (sid, username, exp) VALUES (?, ?, ?)');
  const sDel = sql.prepare('DELETE FROM sessions WHERE sid = ?');
  const sDelUser = sql.prepare('DELETE FROM sessions WHERE username = ?');
  const sLive = sql.prepare('SELECT sid, username, exp FROM sessions WHERE exp > ?');
  const sPurge = sql.prepare('DELETE FROM sessions WHERE exp <= ?');

  const get = (k, def) => { const r = qGet.get(k); if (!r) return def; try { return JSON.parse(r.v); } catch (e) { return def; } };
  const put = (k, val) => { qPut.run(k, JSON.stringify(val === undefined ? null : val), Date.now()); };
  const tx = fn => { sql.exec('BEGIN IMMEDIATE'); try { const r = fn(); sql.exec('COMMIT'); return r; } catch (e) { sql.exec('ROLLBACK'); throw e; } };
  const prefix = p => { const o = {}; for (const r of qPrefix.all(p.length, p)) { try { o[r.k.slice(p.length)] = JSON.parse(r.v); } catch (e) {} } return o; };
  const isEmpty = () => qCount.get().n === 0;

  function backup(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10), f = path.join(dir, `tridi-${day}.db`);
    if (fs.existsSync(f)) return null;
    sql.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(dir).filter(x => /^tridi-\d{4}-\d{2}-\d{2}\.db$/.test(x)).sort();
    old.slice(0, Math.max(0, old.length - 30)).forEach(x => { try { fs.unlinkSync(path.join(dir, x)); } catch (e) {} });
    return f;
  }

  return {
    file, raw: sql, get, put, tx, prefix, isEmpty, backup,
    sessions: {
      save: (sid, username, exp) => sPut.run(sid, username, exp),
      remove: sid => sDel.run(sid),
      removeUser: username => sDelUser.run(username),
      live: () => sLive.all(Date.now()),
      purge: () => sPurge.run(Date.now())
    }
  };
};
