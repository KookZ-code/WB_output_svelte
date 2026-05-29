// better-sqlite3 connection — opens the LOCAL CACHE that's mirrored from the
// share by db-sync.
//
// On every db() call:
//   1. Ask db-sync if the share is newer than our last sync (mtime check)
//   2. If yes — close any open conn (Windows EPERM otherwise), copy, reopen
//   3. Otherwise reuse the cached conn

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { getLocalPath, needsSync, runSync } from './db-sync';

let conn: DB | null = null;

function openConn(path: string): DB {
  const c = new Database(path, { readonly: true, fileMustExist: true });
  c.pragma('query_only = ON');
  return c;
}

export function db(): DB {
  const localPath = getLocalPath();
  const shareMtime = needsSync();

  if (shareMtime !== null) {
    // Share has newer data (or no local copy yet) — close + sync + reopen
    if (conn) {
      conn.close();
      conn = null;
    }
    runSync(shareMtime);
  } else if (!conn && !existsSync(localPath)) {
    // Nothing to sync from AND no local cache — fatal
    throw new Error('DB share unreachable and no local cache available');
  }

  if (!conn) conn = openConn(localPath);
  return conn;
}

/**
 * Build the WHERE clause that filters by either `package` or the mpc-derived key.
 * Values come from our own dropdown (which was built from query results), so
 * inline string-concat with simple quote-escaping matches the original Rust.
 */
export function buildPkgClause(filter: string[]): string {
  if (filter.length === 0) return '';
  const list = filter.map((p) => `'${p.replace(/'/g, "''")}'`).join(', ');
  return `AND (package IN (${list}) OR \
COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END) IN (${list}))`;
}
