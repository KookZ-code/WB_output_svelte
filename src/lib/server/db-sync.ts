// Mirror the share-DB to a local cache file so better-sqlite3 / SQLite
// don't try to lock files on an SMB share (which fails with SQLITE_CANTOPEN).
//
// Two-step protocol because Windows locks open files:
//   1. `needsSync()` checks share mtime vs last-synced mtime — pure read, fast
//   2. `runSync()` performs the copy+rename — caller MUST close any open
//      DB connection to the local cache BEFORE calling this, otherwise the
//      rename fails with EPERM on Windows.

import { copyFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DB_PATH } from './config';

const CACHE_DIR = join(process.cwd(), 'data', '.cache');
const LOCAL_DB = join(CACHE_DIR, 'central.db');

let lastSyncedMtimeMs = 0;

export function getLocalPath(): string {
  return LOCAL_DB;
}

/** Returns share mtime if newer than our last sync OR local doesn't exist. Null otherwise. */
export function needsSync(): number | null {
  if (!existsSync(LOCAL_DB)) {
    // No local copy yet — must sync regardless of share mtime
    try {
      return statSync(DB_PATH).mtimeMs;
    } catch {
      return null;
    }
  }
  let shareMtime: number;
  try {
    shareMtime = statSync(DB_PATH).mtimeMs;
  } catch {
    return null; // share unreachable — keep using local
  }
  return shareMtime > lastSyncedMtimeMs ? shareMtime : null;
}

/** Copy share → local. Caller must have closed any open connection to LOCAL_DB. */
export function runSync(shareMtime: number): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  const tmp = LOCAL_DB + '.tmp';
  copyFileSync(DB_PATH, tmp);
  renameSync(tmp, LOCAL_DB);
  lastSyncedMtimeMs = shareMtime;
}
