// better-sqlite3 connection — single read-only handle reused across requests.
// PRAGMA query_only = ON belt-and-braces: even if `readonly` flag were toggled,
// no writes can happen.

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { DB_PATH } from './config';

let conn: DB | null = null;

export function db(): DB {
  if (!conn) {
    conn = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    conn.pragma('journal_mode = WAL');
    conn.pragma('query_only = ON');
  }
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
