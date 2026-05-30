// Port of WB_Dashboard/src/db.rs query_hourly.
//
// This is the most involved query: it loads all in-shift records once, plus
// pre-shift baselines per (machine, lot), then for each hour slot computes the
// reset-aware cumulative output up to slot_end starting from the appropriate
// baseline. Reset-aware (see delta.ts) handles a capillary (cap) change that
// resets bonded_unit to 0 mid-lot; a plain MAX would drop all post-reset units.
//
// Baseline rules (in priority):
//   1. pre-shift last value if exists
//   2. carry-over: if first scan's implied UPH > reported UPH × 2 → use first.bonded
//   3. genuinely new lot → 0

import { db, buildPkgClause } from '../db';
import { slotEndForHour, parseSqlTs, type ShiftWindow } from '../shift';
import { resetAwareTotal } from './delta';

interface Rec {
  package: string;
  machine_id: string;
  lot_id: string;
  bonded: number;
  ts: string;
  uph: number;
}

export function queryHourly(w: ShiftWindow, pkgFilter: string[]): Map<string, number[]> {
  const conn = db();

  // Pre-shift baselines: latest bonded_unit per (machine, lot) before shift_start
  const preStmt = conn.prepare(
    `SELECT machine_id, lot_id, bonded_unit
     FROM uph_records
     WHERE voided = 0
       AND created_at < @start
     ORDER BY machine_id, lot_id, created_at DESC`
  );
  const preRows = preStmt.all({ start: w.start }) as Array<{
    machine_id: string;
    lot_id: string;
    bonded_unit: number;
  }>;
  const preBaselines = new Map<string, number>();
  for (const r of preRows) {
    const k = `${r.machine_id}${r.lot_id}`;
    if (!preBaselines.has(k)) preBaselines.set(k, r.bonded_unit);
  }

  const pkgClause = buildPkgClause(pkgFilter);
  const sql = `SELECT COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END) AS pkg_key,
            machine_id, lot_id, bonded_unit, created_at, uph
     FROM uph_records
     WHERE voided = 0
       AND created_at >= @start
       AND created_at <= @end
       ${pkgClause}
     ORDER BY created_at`;

  const raw = conn.prepare(sql).all({ start: w.start, end: w.end }) as Array<{
    pkg_key: string;
    machine_id: string;
    lot_id: string;
    bonded_unit: number;
    created_at: string;
    uph: number;
  }>;

  const recs: Rec[] = raw.map((r) => ({
    package: r.pkg_key.trim(),
    machine_id: r.machine_id,
    lot_id: r.lot_id,
    bonded: r.bonded_unit,
    ts: r.created_at,
    uph: r.uph,
  }));

  // First scan info per (package, machine, lot): bonded, ts, uph
  const firstScan = new Map<string, { bonded: number; ts: string; uph: number }>();
  for (const r of recs) {
    const key = `${r.package}${r.machine_id}${r.lot_id}`;
    if (!firstScan.has(key)) {
      firstScan.set(key, { bonded: r.bonded, ts: r.ts, uph: r.uph });
    }
  }

  // Time-ordered scan series per (package, machine, lot). recs is already
  // ordered by created_at, so each series' bonded values are in time order.
  const series = new Map<
    string,
    { pkg: string; machine: string; lot: string; ts: string[]; bonded: number[] }
  >();
  for (const r of recs) {
    const key = `${r.package}${r.machine_id}${r.lot_id}`;
    let s = series.get(key);
    if (!s) {
      s = { pkg: r.package, machine: r.machine_id, lot: r.lot_id, ts: [], bonded: [] };
      series.set(key, s);
    }
    s.ts.push(r.ts);
    s.bonded.push(r.bonded);
  }

  // Hours since shift_start for a "YYYY-MM-DD HH:MM:SS" timestamp
  const startMs = parseSqlTs(w.start);
  const parseHours = (ts: string): number => {
    const ms = parseSqlTs(ts);
    return (ms - startMs) / 3_600_000;
  };

  const pkgMap = new Map<string, number[]>();
  const nHours = w.hours.length;

  for (let slotIdx = 0; slotIdx < nHours; slotIdx++) {
    const h = w.hours[slotIdx];
    const slotEnd = slotEndForHour(w, slotIdx, h);

    const slotTotals = new Map<string, number>();
    for (const [key, s] of series) {
      // bonded values scanned up to slotEnd (ts ascending -> break early)
      const vals: number[] = [];
      for (let i = 0; i < s.ts.length; i++) {
        if (s.ts[i] <= slotEnd) vals.push(s.bonded[i]);
        else break;
      }
      if (vals.length === 0) continue;

      const preKey = `${s.machine}${s.lot}`;
      let baseline: number;
      const pre = preBaselines.get(preKey);
      if (pre !== undefined) {
        baseline = pre;
      } else {
        const fs = firstScan.get(key);
        if (fs) {
          const elapsed = parseHours(fs.ts);
          if (elapsed > 0 && fs.uph > 0) {
            const implied = fs.bonded / elapsed;
            baseline = implied > fs.uph * 2 ? fs.bonded : 0;
          } else {
            baseline = 0;
          }
        } else {
          baseline = 0;
        }
      }
      const delta = resetAwareTotal(baseline, vals);
      slotTotals.set(s.pkg, (slotTotals.get(s.pkg) ?? 0) + delta);
    }

    for (const [pkg, total] of slotTotals) {
      let arr = pkgMap.get(pkg);
      if (!arr) {
        arr = new Array<number>(nHours).fill(0);
        pkgMap.set(pkg, arr);
      }
      arr[slotIdx] = total;
    }
  }

  // Ensure every series has the right length (defensive)
  for (const arr of pkgMap.values()) {
    while (arr.length < nHours) arr.push(0);
  }

  return pkgMap;
}
