// Lazy singleton wrapper around loadPlan(). Reloads when the XLSX file mtime changes.
import { statSync } from 'node:fs';
import { XLSX_PATH } from './config';
import { loadPlan, type PlanData } from './excel';

let cached: { data: PlanData; mtimeMs: number } | null = null;

export function getPlan(): PlanData {
  const stat = statSync(XLSX_PATH);
  if (!cached || cached.mtimeMs !== stat.mtimeMs) {
    cached = { data: loadPlan(XLSX_PATH), mtimeMs: stat.mtimeMs };
  }
  return cached.data;
}
