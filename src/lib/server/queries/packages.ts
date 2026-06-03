// Port of WB_Dashboard/src/db.rs query_packages

import { db, buildPkgClause } from '../db';
import { slotEndForHour, type ShiftWindow } from '../shift';
import type { PackageRow, PlanRow } from '$lib/types/dashboard';

export function queryPackages(
  w: ShiftWindow,
  hour: number,
  planMap: Map<string, PlanRow>,
  mpcPlanMap: Map<string, PlanRow>,
  pkgFilter: string[]
): PackageRow[] {
  const slotIdx = Math.max(0, w.hours.indexOf(hour));
  const slotEnd = slotEndForHour(w, slotIdx, hour);
  const hourFraction = (slotIdx + 1) / w.hours.length;

  const pkgClause = buildPkgClause(pkgFilter);
  const sql = `SELECT pkg_key, COALESCE(SUM(delta), 0) AS bonded
     FROM (
         SELECT COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END) AS pkg_key, machine_id, lot_id,
                MAX(0, MAX(bonded_unit) - COALESCE(
                    (SELECT bonded_unit FROM uph_records pre
                     WHERE pre.machine_id = main.machine_id
                       AND pre.lot_id     = main.lot_id
                       AND pre.voided     = 0
                       AND pre.created_at < @start
                     ORDER BY pre.created_at DESC LIMIT 1),
                    (SELECT
                        CASE
                            WHEN (julianday(f.created_at) - julianday(@start)) > 0
                             AND f.bonded_unit /
                                 ((julianday(f.created_at) - julianday(@start)) * 24.0) > f.uph * 2
                            THEN f.bonded_unit
                            ELSE 0
                        END
                     FROM uph_records f
                     WHERE f.machine_id = main.machine_id
                       AND f.lot_id     = main.lot_id
                       AND f.voided     = 0
                       AND f.created_at >= @start
                       AND f.created_at <= @slot_end
                     ORDER BY f.created_at ASC LIMIT 1)
                )) AS delta
         FROM uph_records main
         WHERE voided = 0
           AND created_at >= @start
           AND created_at <= @slot_end
           ${pkgClause}
         GROUP BY COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END), machine_id, lot_id
     )
     GROUP BY pkg_key
     ORDER BY bonded DESC`;

  const rows = db().prepare(sql).all({ start: w.start, slot_end: slotEnd }) as Array<{
    pkg_key: string;
    bonded: number;
  }>;

  // Build rows, then merge variants that share a base plan.
  // When a pkg_key has no MPC-specific plan (mpcPlanMap miss), all variants
  // with the same base (e.g. "8SOIC(C2X)" + "8SOIC(CYX)" → "8SOIC") are
  // summed together and compared against the single base plan.
  const mpcRows: PackageRow[] = [];
  const baseMerge = new Map<string, PackageRow>();

  for (const { pkg_key, bonded } of rows) {
    const basePkg = pkg_key.split('(')[0] ?? pkg_key;
    const mpcPlanRow = mpcPlanMap.get(pkg_key);

    if (mpcPlanRow) {
      // Has its own MPC plan — keep separate
      const target = Math.trunc(mpcPlanRow.plan_per_shift * hourFraction);
      const pct = target > 0 ? ((bonded - target) / target) * 100 : 0;
      mpcRows.push({ package: pkg_key, plan_per_shift: mpcPlanRow.plan_per_shift, bonded, target, pct });
    } else {
      // Falls back to base plan — merge all variants together
      const planRow = planMap.get(basePkg);
      const planPerShift = planRow?.plan_per_shift ?? 0;
      const target = planRow ? Math.trunc(planPerShift * hourFraction) : 0;
      const existing = baseMerge.get(basePkg);
      if (existing) {
        existing.bonded += bonded;
        existing.pct = existing.target > 0 ? ((existing.bonded - existing.target) / existing.target) * 100 : 0;
      } else {
        const pct = target > 0 ? ((bonded - target) / target) * 100 : 0;
        baseMerge.set(basePkg, { package: basePkg, plan_per_shift: planPerShift, bonded, target, pct });
      }
    }
  }

  return [...mpcRows, ...baseMerge.values()].sort((a, b) => b.bonded - a.bonded);
}
