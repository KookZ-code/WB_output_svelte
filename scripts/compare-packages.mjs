// Diagnostic: compare package keys in DB vs Excel plan.
// Usage: node scripts/compare-packages.mjs [days-back]
//   days-back defaults to 7.

import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DAYS_BACK = Number(process.argv[2] ?? 7);
const XLSX_PATH = 'D:/claude/WB_Dashboard/data/wb_plan.xlsx';
const CACHE_DIR = join(process.cwd(), 'data', '.cache');

function findCacheDb() {
  const files = readdirSync(CACHE_DIR).filter((f) => /^central\.\d+\.db$/.test(f));
  if (files.length === 0) throw new Error('No local DB cache — start the dev server first');
  files.sort((a, b) => statSync(join(CACHE_DIR, b)).mtimeMs - statSync(join(CACHE_DIR, a)).mtimeMs);
  return join(CACHE_DIR, files[0]);
}

// ── Normalisation (mirrors excel.ts, NBSP =  ) ──────────────────────────

const NBSP = ' ';
function clean(raw) {
  return raw.replace(new RegExp(NBSP, 'g'), '').trim();
}

/** Standard short key — strips qualifier suffixes (HD, UD, IDF) and size specs.
 *  Matches production excel.ts normalizePackage. */
function normalizeBase(raw) {
  const s = clean(raw);
  let i = 0, digits = '';
  while (i < s.length && /[0-9]/.test(s[i])) { digits += s[i++]; }
  if (!digits) return s;
  if (s[i] !== 'L' && s[i] !== 'l') return s.split(/\s+/)[0];
  i++;
  if (s[i] === ' ') i++;
  let rest = '';
  while (i < s.length && s[i] !== ' ' && s[i] !== '(') { rest += s[i++]; }
  const norm = digits + rest;
  return norm === '8EIAJ' ? '8SOIJ' : norm;
}

/** Extended key — like normalizeBase but KEEPS a word-only qualifier (HD, UD, IDF…)
 *  that follows the package type. Size specs (e.g. 6X6, 7x7) are still dropped.
 *
 *  Examples:
 *    "44L TQFP HD 7x7"  → "44TQFP HD"
 *    "8LSOIC IDF"       → "8SOIC IDF"
 *    "20SSOP UD"        → "20SSOP UD"
 *    "36L SQFN 6X6(UDX)"→ "36SQFN"   (6X6 has digits → not a qualifier)
 *    "44L TQFP 7x7"     → "44TQFP"
 */
function normalizeFull(raw) {
  const s = clean(raw);
  let i = 0, digits = '';
  while (i < s.length && /[0-9]/.test(s[i])) { digits += s[i++]; }
  if (!digits) return s;

  let base;
  if (s[i] !== 'L' && s[i] !== 'l') {
    base = s.split(/\s+/)[0];
    // After "44TQFP", skip to next word and check for word-only qualifier
    const rest = s.slice(base.length).trimStart();
    const nextWord = rest.split(/\s+/)[0] ?? '';
    if (nextWord && /^[A-Za-z]+$/.test(nextWord)) return `${base} ${nextWord}`;
    return base;
  }
  i++; // consume L
  if (s[i] === ' ') i++;
  let typeStr = '';
  while (i < s.length && s[i] !== ' ' && s[i] !== '(') { typeStr += s[i++]; }
  const norm = digits + typeStr === '8EIAJ' ? '8SOIJ' : digits + typeStr;
  base = norm;

  // Skip whitespace then check for a word-only qualifier
  while (i < s.length && s[i] === ' ') i++;
  if (i < s.length && s[i] !== '(') {
    let qualifier = '';
    const j = i;
    while (i < s.length && s[i] !== ' ' && s[i] !== '(') { qualifier += s[i++]; }
    if (/^[A-Za-z]+$/.test(qualifier)) return `${base} ${qualifier}`;
    i = j; // not a qualifier, reset
  }
  return base;
}

function normalizeMpcKey(raw) {
  const s = clean(raw);
  const open = s.lastIndexOf('('), close = s.lastIndexOf(')');
  if (open < 0 || close <= open) return null;
  const code = s.slice(open + 1, close);
  if (code.length !== 3 || !/^[A-Za-z0-9]+$/.test(code)) return null;
  return `${normalizeBase(s)}(${code})`;
}

function loadExcelPackages() {
  const buf = readFileSync(XLSX_PATH);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const skip = ['TOTAL', 'Grand', 'PACKAGE'];

  const bases = new Set();    // "44TQFP"
  const fullKeys = new Set(); // "44TQFP HD"
  const mpcKeys = new Set();  // "36SQFN(UDX)"
  const rawList = [];

  for (let r = 2; r < matrix.length; r++) {
    const raw = matrix[r]?.[0];
    if (typeof raw !== 'string') continue;
    const s = clean(raw);
    if (!s || skip.some((k) => s.startsWith(k))) continue;

    const base = normalizeBase(s);
    const full = normalizeFull(s);
    const mpc  = normalizeMpcKey(s);
    bases.add(base);
    fullKeys.add(full);
    if (mpc) mpcKeys.add(mpc);
    rawList.push({ raw: s, base, full, mpc });
  }
  return { bases, fullKeys, mpcKeys, rawList };
}

// ── DB query ─────────────────────────────────────────────────────────────────
function loadDbPackages(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  const since = new Date(Date.now() - DAYS_BACK * 86_400_000)
    .toISOString().slice(0, 19).replace('T', ' ');

  const rows = db.prepare(`
    SELECT
      package                                                         AS raw_pkg,
      COALESCE(package_mpc,
        CASE WHEN mpc IS NOT NULL AND LENGTH(mpc) >= 9
             THEN package || '(' || SUBSTR(mpc, 7, 3) || ')'
             ELSE package END)                                        AS derived_key,
      COUNT(DISTINCT machine_id)                                      AS machines,
      COUNT(*)                                                        AS records,
      MAX(created_at)                                                 AS last_seen
    FROM uph_records
    WHERE voided = 0 AND created_at >= @since
    GROUP BY derived_key
    ORDER BY records DESC
  `).all({ since });

  db.close();
  return rows;
}

// ── Classify each DB key ──────────────────────────────────────────────────────
// Priority:  MPC exact  >  full key (includes HD/UD)  >  base  >  not in plan
function classifyKey(derivedKey, { bases, fullKeys, mpcKeys }) {
  if (mpcKeys.has(derivedKey)) return 'mpc';
  if (fullKeys.has(derivedKey)) return 'full';                  // e.g. "44TQFP HD"
  const baseOnly = derivedKey.split('(')[0].split(' ')[0];      // strip "(MPC)" and " HD"
  if (bases.has(baseOnly)) return 'base';
  return 'none';
}

// ── Main ─────────────────────────────────────────────────────────────────────
const dbPath = findCacheDb();
console.log(`DB cache : ${dbPath}`);
console.log(`XLSX     : ${XLSX_PATH}`);
console.log(`Period   : last ${DAYS_BACK} day(s)\n`);

const excelPkgs = loadExcelPackages();
const dbRows    = loadDbPackages(dbPath);

const buckets = { mpc: [], full: [], base: [], none: [] };
for (const r of dbRows) {
  buckets[classifyKey(r.derived_key, excelPkgs)].push(r);
}

const W   = [28, 22, 6, 7, 19];
const pad = (v, n) => String(v ?? '').padEnd(n);
const hdr = `${pad('DERIVED KEY',W[0])} ${pad('RAW PKG',W[1])} ${pad('MACH',W[2])} ${pad('RECS',W[3])} LAST SEEN`;
const sep = '─'.repeat(hdr.length);

function printSection(title, rows) {
  console.log(`\n${'═'.repeat(72)}\n${title}\n${'═'.repeat(72)}`);
  if (rows.length === 0) { console.log('  (none)'); return; }
  console.log(hdr); console.log(sep);
  for (const r of rows)
    console.log(`${pad(r.derived_key,W[0])} ${pad(r.raw_pkg,W[1])} ${pad(r.machines,W[2])} ${pad(r.records,W[3])} ${r.last_seen}`);
}

printSection('IN PLAN — MPC variant  (exact match)',  buckets.mpc);
printSection('IN PLAN — Full key match  (e.g. "44TQFP HD")', buckets.full);
printSection('IN PLAN — Base match  (no qualifier)',  buckets.base);
printSection('NOT IN PLAN  ← ต้องตรวจสอบ / เพิ่มใน Excel', buckets.none);

console.log(`\nSummary: ${buckets.mpc.length} MPC, ${buckets.full.length} full-key, ${buckets.base.length} base, ${buckets.none.length} NOT IN PLAN`);

// Plan entries with no DB activity
const activeFullKeys = new Set(dbRows.map((r) => r.derived_key));
const activeBases    = new Set(dbRows.map((r) => r.derived_key.split('(')[0].split(' ')[0]));
const inactive = excelPkgs.rawList.filter(
  (p) => !activeFullKeys.has(p.full) && !activeFullKeys.has(p.base) && !activeBases.has(p.base)
);
if (inactive.length > 0) {
  console.log(`\n${'═'.repeat(72)}\nIN PLAN but no DB activity (last ${DAYS_BACK}d)\n${'═'.repeat(72)}`);
  const seen = new Set();
  for (const p of inactive) {
    if (!seen.has(p.full)) { seen.add(p.full); console.log(`  ${p.full.padEnd(24)} ← Excel: "${p.raw}"`); }
  }
}
