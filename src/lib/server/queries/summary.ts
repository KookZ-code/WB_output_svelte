// Port of WB_Dashboard/src/db.rs query_summary.
//
// Aggregates per (machine, lot) the reset-aware output over the shift, starting
// from a pre-shift baseline (with a carry-over heuristic when no pre-shift
// record exists), then sums to total bonded / distinct machines / avg uph.
//
// Computed in JS (rather than the old MAX(bonded)-baseline SQL) because a
// capillary (cap) change resets bonded_unit to 0 mid-lot, and a MAX would drop
// all post-reset units. Reset-aware logic lives in delta.ts.
// Baseline rules match query_hourly: pre-shift last value → carry-over → 0.

import { db, buildPkgClause } from '../db';
import { parseSqlTs, type ShiftWindow } from '../shift';
import { resetAwareTotal } from './delta';

export interface SummaryQueryRow {
  total_bonded: number;
  active_machines: number;
  avg_uph: number;
}

export function querySummary(w: ShiftWindow, pkgFilter: string[]): SummaryQueryRow {
  const conn = db();

  // Pre-shift baselines: latest bonded_unit per (machine, lot) before shift start
  const preRows = conn
    .prepare(
      `SELECT machine_id, lot_id, bonded_unit
       FROM uph_records
       WHERE voided = 0 AND created_at < @start
       ORDER BY machine_id, lot_id, created_at DESC`
    )
    .all({ start: w.start }) as Array<{ machine_id: string; lot_id: string; bonded_unit: number }>;
  const preBaselines = new Map<string, number>();
  for (const r of preRows) {
    const k = `${r.machine_id}${r.lot_id}`;
    if (!preBaselines.has(k)) preBaselines.set(k, r.bonded_unit);
  }

  const pkgClause = buildPkgClause(pkgFilter);
  const rows = conn
    .prepare(
      `SELECT machine_id, lot_id, bonded_unit, created_at, uph
       FROM uph_records
       WHERE voided = 0
         AND created_at >= @start
         AND created_at <= @end
         ${pkgClause}
       ORDER BY created_at`
    )
    .all({ start: w.start, end: w.end }) as Array<{
    machine_id: string;
    lot_id: string;
    bonded_unit: number;
    created_at: string;
    uph: number;
  }>;

  // Group by (machine, lot): time-ordered bonded values + first scan + uph mean.
  // rows are ordered by created_at, so `bonded` and `firstTs` are in time order.
  interface Group {
    machine: string;
    lot: string;
    bonded: number[];
    firstTs: string;
    firstBonded: number;
    firstUph: number;
    uphSum: number;
    uphCount: number;
  }
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.machine_id}${r.lot_id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        machine: r.machine_id,
        lot: r.lot_id,
        bonded: [],
        firstTs: r.created_at,
        firstBonded: r.bonded_unit,
        firstUph: r.uph,
        uphSum: 0,
        uphCount: 0,
      };
      groups.set(key, g);
    }
    g.bonded.push(r.bonded_unit);
    g.uphSum += r.uph;
    g.uphCount += 1;
  }

  const startMs = parseSqlTs(w.start);

  let totalBonded = 0;
  const machines = new Set<string>();
  let avgUphSum = 0; // sum of per-group AVG(uph), averaged at the end

  for (const g of groups.values()) {
    let baseline: number;
    const pre = preBaselines.get(`${g.machine}${g.lot}`);
    if (pre !== undefined) {
      baseline = pre;
    } else {
      const elapsedH = (parseSqlTs(g.firstTs) - startMs) / 3_600_000;
      if (elapsedH > 0 && g.firstUph > 0) {
        const implied = g.firstBonded / elapsedH;
        baseline = implied > g.firstUph * 2 ? g.firstBonded : 0;
      } else {
        baseline = 0;
      }
    }
    totalBonded += resetAwareTotal(baseline, g.bonded);
    machines.add(g.machine);
    avgUphSum += g.uphSum / g.uphCount;
  }

  return {
    total_bonded: totalBonded,
    active_machines: machines.size,
    avg_uph: groups.size > 0 ? avgUphSum / groups.size : 0,
  };
}
