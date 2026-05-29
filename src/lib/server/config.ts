// Server-only env reader. Throws fast if a required path is missing or unreadable.
import { existsSync } from 'node:fs';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name} (set in .env)`);
  return v;
}

export const DB_PATH = required('DB_PATH');
export const XLSX_PATH = required('XLSX_PATH');

if (!existsSync(DB_PATH)) {
  throw new Error(`DB_PATH does not exist: ${DB_PATH}`);
}
if (!existsSync(XLSX_PATH)) {
  throw new Error(`XLSX_PATH does not exist: ${XLSX_PATH}`);
}
