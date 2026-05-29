// Port of WB_Dashboard/src/db.rs query_hourly.
//
// This is the most involved query: it loads all in-shift records once, plus
// pre-shift baselines per (machine, lot), then for each hour slot computes
// MAX(bonded_unit) up to slot_end and subtracts the appropriate baseline.
//
// Baseline rules (in priority):
//   1. pre-shift last value if exists
//   2. carry-over: if first scan's implied UPH > reported UPH × 2 → use first.bonded
//   3. genuinely new lot → 0

import { db, buildPkgClause } from '../db';
import { slotEndForHour, type ShiftWindow } from '../shift';

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
    const k = `${r.machine_id}${r.lot_id}`;
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
    const key = `${r.package}${r.machine_id}${r.lot_id}`;
    if (!firstScan.has(key)) {
      firstScan.set(key, { bonded: r.bonded, ts: r.ts, uph: r.uph });
    }
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

    // For each (pkg, machine, lot) group: MAX bonded_unit up to slotEnd
    const maxUpTo = new Map<string, { pkg: string; machine: string; lot: string; max: number }>();
    for (const r of recs) {
      if (r.ts <= slotEnd) {
        const key = `${r.package}${r.machine_id}${r.lot_id}`;
        const existing = maxUpTo.get(key);
        if (!existing) {
          maxUpTo.set(key, {
            pkg: r.package,
            machine: r.machine_id,
            lot: r.lot_id,
            max: r.bonded,
          });
        } else if (r.bonded > existing.max) {
          existing.max = r.bonded;
        }
      }
    }

    const slotTotals = new Map<string, number>();
    for (const [key, g] of maxUpTo) {
      const preKey = `${g.machine}${g.lot}`;
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
      const delta = Math.max(0, g.max - baseline);
      slotTotals.set(g.pkg, (slotTotals.get(g.pkg) ?? 0) + delta);
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

/** Parse "YYYY-MM-DD HH:MM:SS" to epoch ms (treats as UTC for arithmetic only). */
function parseSqlTs(ts: string): number {
  // Date.UTC arithmetic — only relative differences matter, so UTC vs local
  // doesn't change `t2 - t1` as long as we're consistent.
  const y = +ts.slice(0, 4);
  const m = +ts.slice(5, 7);
  const d = +ts.slice(8, 10);
  const hh = +ts.slice(11, 13);
  const mm = +ts.slice(14, 16);
  const ss = +ts.slice(17, 19);
  return Date.UTC(y, m - 1, d, hh, mm, ss);
}
