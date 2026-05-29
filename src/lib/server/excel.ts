// Port of WB_Dashboard/src/excel.rs
//
// Two layouts of package names exist in the plan:
//   "8LSOIC IDF"      → "8SOIC"     (L immediately after digits, space = size suffix)
//   "36L SQFN 6X6..." → "36SQFN"    (space between L and type — concatenate digits+type)
// Manual override: "8LEIAJ" → "8SOIJ" (machines report SOIJ, plan uses EIAJ)

import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import type { PlanRow } from '$lib/types/dashboard';

const NBSP = ' ';

function clean(raw: string): string {
  return raw.replace(new RegExp(NBSP, 'g'), '').trim();
}

/** Normalize for display only — Excel-derived name without DB-name override. */
export function normalizeDisplay(raw: string): string {
  const s = clean(raw);
  let i = 0;
  let digits = '';
  while (i < s.length && /[0-9]/.test(s[i])) {
    digits += s[i];
    i++;
  }
  if (digits.length === 0) return s;
  if (s[i] !== 'L' && s[i] !== 'l') {
    // No L — drop everything after first space
    return s.split(/\s+/)[0];
  }
  i++; // consume L
  let rest = '';
  if (s[i] === ' ') {
    i++;
    while (i < s.length && s[i] !== ' ' && s[i] !== '(') {
      rest += s[i];
      i++;
    }
  } else {
    while (i < s.length && s[i] !== ' ' && s[i] !== '(') {
      rest += s[i];
      i++;
    }
  }
  return digits + rest;
}

/**
 * Normalize an Excel package name to the short DB key.
 *   "8LSOIC IDF"       → "8SOIC"
 *   "36L SQFN 6X6(UDX)" → "36SQFN"
 *   "8LEIAJ"           → "8SOIJ"   (manual override)
 */
export function normalizePackage(raw: string): string {
  const s = clean(raw);
  let i = 0;
  let digits = '';
  while (i < s.length && /[0-9]/.test(s[i])) {
    digits += s[i];
    i++;
  }
  if (digits.length === 0) return s;
  if (s[i] !== 'L' && s[i] !== 'l') {
    return s.split(/\s+/)[0];
  }
  i++; // consume L
  let rest = '';
  if (s[i] === ' ') {
    i++;
    while (i < s.length && s[i] !== ' ' && s[i] !== '(') {
      rest += s[i];
      i++;
    }
  } else {
    while (i < s.length && s[i] !== ' ' && s[i] !== '(') {
      rest += s[i];
      i++;
    }
  }
  const normalized = digits + rest;
  if (normalized === '8EIAJ') return '8SOIJ';
  return normalized;
}

/**
 * Extract MPC plan key `PACKAGE(CODE)` from a raw Excel name.
 * Code must be exactly 3 alphanumeric chars.
 *   "20LVQFN 3x3(REB)" → "20VQFN(REB)"
 *   "8LEIAJ"           → null
 */
export function normalizeMpcKey(raw: string): string | null {
  const s = clean(raw);
  const open = s.lastIndexOf('(');
  const close = s.lastIndexOf(')');
  if (open < 0 || close <= open) return null;
  const code = s.slice(open + 1, close);
  if (code.length !== 3 || !/^[A-Za-z0-9]+$/.test(code)) return null;
  const base = normalizePackage(s);
  return `${base}(${code})`;
}

function cellAsNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(new RegExp(NBSP, 'g'), '').replace(/,/g, '').trim();
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export interface PlanData {
  rows: PlanRow[];
  planMap: Map<string, PlanRow>; // keyed by package_norm
  mpcPlanMap: Map<string, PlanRow>; // keyed by "PACKAGE(CODE)"
  displayNames: Map<string, string>; // db_norm → Excel display
}

/**
 * Load the full plan workbook. Aggregates plan_per_shift by SUM and uph_target
 * by "the row with the largest plan share" (per the Rust source's heuristic).
 */
export function loadPlan(path: string): PlanData {
  // Read with Node's fs and pass to XLSX.read — XLSX.readFile relies on a
  // dynamic require of `fs` that Vite SSR rewrites incorrectly.
  const buf = readFileSync(path);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('No sheets in workbook');
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }) as unknown[][];

  const rows: PlanRow[] = [];
  const skipKeywords = ['TOTAL', 'Grand', 'PACKAGE'];

  // Skip first 2 rows (header), like the Rust loop's `skip(2)`
  for (let r = 2; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row) continue;
    const pkgCell = row[0];
    if (typeof pkgCell !== 'string') continue;
    const pkgRaw = clean(pkgCell);
    if (!pkgRaw) continue;
    if (skipKeywords.some((k) => pkgRaw.startsWith(k))) continue;

    const planDay = Math.trunc(cellAsNumber(row[1]));
    const planShift = Math.trunc(cellAsNumber(row[2]));
    const uph = cellAsNumber(row[3]);
    if (planDay === 0 && planShift === 0 && uph === 0) continue;

    rows.push({
      package_raw: pkgRaw,
      package_norm: normalizePackage(pkgRaw),
      plan_per_day: planDay,
      plan_per_shift: planShift,
      uph_target: uph,
    });
  }

  // Aggregate by normalized name: SUM plan_*; UPH target = the row whose
  // plan_per_shift is the dominant share (mirrors the Rust heuristic).
  const planMap = new Map<string, PlanRow>();
  for (const r of rows) {
    const existing = planMap.get(r.package_norm);
    if (!existing) {
      planMap.set(r.package_norm, { ...r });
      continue;
    }
    existing.plan_per_day += r.plan_per_day;
    existing.plan_per_shift += r.plan_per_shift;
    // Match Rust: `if r.plan_per_shift > entry.plan_per_shift - r.plan_per_shift`
    // i.e. this row's share > all-prior rows' share combined → adopt its UPH.
    if (r.plan_per_shift > existing.plan_per_shift - r.plan_per_shift) {
      existing.uph_target = r.uph_target;
    }
  }

  // Per-variant exact UPH: keyed by "PACKAGE(CODE)"
  const mpcPlanMap = new Map<string, PlanRow>();
  for (const r of rows) {
    const key = normalizeMpcKey(r.package_raw);
    if (key && !mpcPlanMap.has(key)) {
      mpcPlanMap.set(key, { ...r });
    }
  }

  // Display names — only when display differs from normalized DB key
  const displayNames = new Map<string, string>();
  for (const r of rows) {
    const display = normalizeDisplay(r.package_raw);
    if (display !== r.package_norm && !displayNames.has(r.package_norm)) {
      displayNames.set(r.package_norm, display);
    }
  }

  return { rows, planMap, mpcPlanMap, displayNames };
}
