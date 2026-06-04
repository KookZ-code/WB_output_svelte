// Port of WB_Dashboard/src/db.rs query_machines
//
// Uses the same reset-aware approach as hourly.ts: load all in-slot records
// once, build per-(machine,lot) bonded series, apply resetAwareTotal.
// The old MAX(bonded_unit)-baseline formula silently dropped all production
// after a capillary change whose counter reset was straddled between shifts
// (pre-shift baseline ≥ in-shift MAX → delta clamps to 0). See
// docs/discussion/cap-reset-output.md.

import { db } from '../db';
import { slotEndForHour, parseSqlTs, type ShiftWindow } from '../shift';
import { resetAwareTotal } from './delta';
import type { MachineRowDb, PlanRow } from '$lib/types/dashboard';

export function queryMachines(
  w: ShiftWindow,
  hour: number,
  packageKey: string,
  planMap: Map<string, PlanRow>,
  mpcPlanMap: Map<string, PlanRow>
): MachineRowDb[] {
  const conn = db();
  const slotIdx = Math.max(0, w.hours.indexOf(hour));
  const slotEnd = slotEndForHour(w, slotIdx, hour);

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

  // All in-slot records for this package, ordered by time
  // Base key (no parens, e.g. "8SOIC") must also catch MPC variants like "8SOIC(C2X)"
  // but must NOT bleed into space-qualified variants like "8SOIC IDF" or "44TQFP HD"
  // which share the same `package` column value. Guard: package_mpc IS NULL (MPC code
  // comes from the `mpc` field, not package_mpc) or package_mpc LIKE 'BASE(%'.
  const pkgFilter =
    packageKey.includes('(')
      ? `AND (COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END) = @pkg)`
      : `AND (COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END) = @pkg
             OR (package = @pkg AND (package_mpc IS NULL OR package_mpc LIKE @pkg || '(%')))`;

  const raw = conn
    .prepare(
      `SELECT machine_id, lot_id, bonded_unit, created_at, uph,
              COALESCE(badge_no, '')  AS badge_no,
              COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9
                       THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END) AS pkg_mpc
       FROM uph_records
       WHERE voided = 0
         AND created_at >= @start
         AND created_at <= @slot_end
         ${pkgFilter}
       ORDER BY created_at`
    )
    .all({ start: w.start, slot_end: slotEnd, pkg: packageKey }) as Array<{
    machine_id: string;
    lot_id: string;
    bonded_unit: number;
    created_at: string;
    uph: number;
    badge_no: string;
    pkg_mpc: string;
  }>;

  // Build per-(machine, lot) series (time-ordered — rows already sorted)
  interface Series {
    machine: string;
    lot: string;
    bonded: number[];
    firstTs: string;
    firstBonded: number;
    firstUph: number;
  }
  const seriesMap = new Map<string, Series>();
  for (const r of raw) {
    const key = `${r.machine_id}\0${r.lot_id}`;
    let s = seriesMap.get(key);
    if (!s) {
      s = { machine: r.machine_id, lot: r.lot_id, bonded: [], firstTs: r.created_at, firstBonded: r.bonded_unit, firstUph: r.uph };
      seriesMap.set(key, s);
    }
    s.bonded.push(r.bonded_unit);
  }

  const startMs = parseSqlTs(w.start);

  // Aggregate per machine: reset-aware output, latest non-zero UPH, badge, pkg_mpc
  interface Agg {
    bonded: number;
    latestUphTs: string;
    latestUph: number;
    lastScanTs: string;
    badge: string;
    pkgMpc: string;
  }
  const machineAgg = new Map<string, Agg>();

  for (const s of seriesMap.values()) {
    const preKey = `${s.machine}${s.lot}`;
    let baseline: number;
    const pre = preBaselines.get(preKey);
    if (pre !== undefined) {
      baseline = pre;
    } else {
      const elapsedH = (parseSqlTs(s.firstTs) - startMs) / 3_600_000;
      if (elapsedH > 0 && s.firstUph > 0) {
        const implied = s.firstBonded / elapsedH;
        baseline = implied > s.firstUph * 2 ? s.firstBonded : 0;
      } else {
        baseline = 0;
      }
    }
    const delta = resetAwareTotal(baseline, s.bonded);
    const agg = machineAgg.get(s.machine);
    if (agg) {
      agg.bonded += delta;
    } else {
      machineAgg.set(s.machine, { bonded: delta, latestUphTs: '', latestUph: 0, lastScanTs: '', badge: '', pkgMpc: '' });
    }
  }

  // Fill latest UPH, badge, pkg_mpc, lastScanTs from raw rows (time-ordered → last wins)
  for (const r of raw) {
    const agg = machineAgg.get(r.machine_id);
    if (!agg) continue;
    if (r.badge_no) agg.badge = r.badge_no;
    if (r.pkg_mpc) agg.pkgMpc = r.pkg_mpc;
    if (r.created_at > agg.lastScanTs) agg.lastScanTs = r.created_at;
    if (r.uph > 0) { agg.latestUph = r.uph; agg.latestUphTs = r.created_at; }
  }

  const elapsedHours = slotIdx + 1;
  const baseUphTarget = planMap.get(packageKey)?.uph_target ?? 0;

  return [...machineAgg.entries()]
    .map(([machine_id, agg]) => {
      const uphTarget = agg.pkgMpc
        ? mpcPlanMap.get(agg.pkgMpc)?.uph_target ?? baseUphTarget
        : baseUphTarget;
      const expectedBonded = uphTarget * elapsedHours;
      const vsOutputPct = expectedBonded > 0 ? ((agg.bonded - expectedBonded) / expectedBonded) * 100 : 0;
      return {
        machine_id,
        badge_no: agg.badge,
        target_uph: uphTarget,
        uph: agg.latestUph,
        bonded_unit: agg.bonded,
        vs_output_pct: vsOutputPct,
        last_scan_ts: agg.lastScanTs || null,
      };
    })
    .sort((a, b) => b.bonded_unit - a.bonded_unit);
}
