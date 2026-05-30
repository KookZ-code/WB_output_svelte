// Server-only env reader. Validates that required env vars are set.
// Path existence is NOT checked here — DB_PATH may be a network share that is
// transiently locked at shift boundaries; db-sync.ts handles that with stale-
// cache fallback. Checking existsSync at module-load time would throw before
// db-sync gets a chance to serve the cached copy.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name} (set in .env)`);
  return v;
}

export const DB_PATH = required('DB_PATH');
export const XLSX_PATH = required('XLSX_PATH');
