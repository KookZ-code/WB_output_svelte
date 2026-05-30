// Mirror the share-DB to a local cache file so better-sqlite3 / SQLite
// don't try to lock files on an SMB share (which fails with SQLITE_CANTOPEN).
//
// Per-PID cache strategy: each Node.js process has its own copy at
//   ./data/.cache/central.<pid>.db
// This avoids EPERM-on-rename when multiple dev servers run concurrently
// (the orphan-vite-process scenario). On module load, files belonging to
// dead PIDs are reaped.
//
// Two-step protocol because Windows locks open files:
//   1. `needsSync()` checks share mtime vs last-synced mtime — pure read, fast
//   2. `runSync()` copies+renames into our own per-PID file (no contention)

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { DB_PATH } from './config';

const CACHE_DIR = join(process.cwd(), 'data', '.cache');
const LOCAL_DB = join(CACHE_DIR, `central.${process.pid}.db`);

let lastSyncedMtimeMs = 0;

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = test only, no kill
    return true;
  } catch {
    return false;
  }
}

/** Best-effort cleanup of cache files left behind by dead PIDs. */
function reapStaleCacheFiles(): void {
  if (!existsSync(CACHE_DIR)) return;
  let entries: string[];
  try {
    entries = readdirSync(CACHE_DIR);
  } catch {
    return;
  }
  // Match: central.<digits>.db, central.<digits>.db-shm, central.<digits>.db-wal, central.<digits>.db.tmp
  // Plus the legacy non-PID names (central.db, central.db-shm, central.db-wal, central.db.tmp)
  const pidRe = /^central\.(\d+)\.db(?:-shm|-wal|\.tmp)?$/;
  const legacyRe = /^central\.db(?:-shm|-wal|\.tmp)?$/;
  for (const f of entries) {
    const m = pidRe.exec(f);
    if (m) {
      const pid = Number(m[1]);
      if (pid !== process.pid && !isPidRunning(pid)) {
        try {
          unlinkSync(join(CACHE_DIR, f));
        } catch {
          /* best-effort */
        }
      }
    } else if (legacyRe.test(f)) {
      // Old-format files from a previous version — reap unconditionally
      try {
        unlinkSync(join(CACHE_DIR, f));
      } catch {
        /* best-effort */
      }
    }
  }
}

// Module-load: clean up after dead siblings
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}
reapStaleCacheFiles();

export function getLocalPath(): string {
  return LOCAL_DB;
}

export function localExists(): boolean {
  return existsSync(LOCAL_DB);
}

/** Returns share mtime if newer than our last sync OR local doesn't exist. Null otherwise. */
export function needsSync(): number | null {
  if (!existsSync(LOCAL_DB)) {
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

function safeUnlink(p: string): void {
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Copy share → local. Caller must have closed any open connection to LOCAL_DB.
 * Throws on failure (caller may then fall back to stale cache if it exists).
 */
export function runSync(shareMtime: number): void {
  const tmp = LOCAL_DB + '.tmp';
  safeUnlink(tmp);
  copyFileSync(DB_PATH, tmp);
  try {
    renameSync(tmp, LOCAL_DB);
  } catch (err) {
    safeUnlink(tmp);
    throw err;
  }
  lastSyncedMtimeMs = shareMtime;
}
