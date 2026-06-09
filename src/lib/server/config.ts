// Server-only env reader. Validates that required env vars are set.
// Hourly-UPH data now comes from the API center (see middleware.ts); the only
// local data source left is the Excel plan file.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name} (set in .env)`);
  return v;
}

export const XLSX_PATH = required('XLSX_PATH');
