// better-sqlite3 connection — opens the LOCAL CACHE that's mirrored from the
// share by db-sync.
//
// On every db() call:
//   1. Ask db-sync if the share is newer than our last sync (mtime check)
//   2. If yes — close any open conn (Windows EPERM otherwise), copy, reopen
//   3. If sync fails but a stale local cache exists, serve it and log
//      a warning rather than 503-ing the whole dashboard
//   4. Otherwise reuse the cached conn

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { getLocalPath, localExists, needsSync, runSync } from './db-sync';

let conn: DB | null = null;
let lastSyncWarning = 0;

function openConn(path: string): DB {
  const c = new Database(path, { readonly: true, fileMustExist: true });
  c.pragma('query_only = ON');
  return c;
}

export function db(): DB {
  const localPath = getLocalPath();
  const shareMtime = needsSync();

  if (shareMtime !== null) {
    if (conn) {
      conn.close();
      conn = null;
    }
    try {
      runSync(shareMtime);
    } catch (err) {
      // Sync failed (e.g. another process locks the local file). Fall back
      // to the stale local copy if we have one — better stale data than 503.
      if (!localExists()) {
        throw new Error(
          `DB sync failed and no local cache: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // Throttle the warning so we don't spam logs once per request
      const now = Date.now();
      if (now - lastSyncWarning > 60_000) {
        lastSyncWarning = now;
        console.warn('[db] sync failed, serving stale cache:', err);
      }
    }
  } else if (!conn && !localExists()) {
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
