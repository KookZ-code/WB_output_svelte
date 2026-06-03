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

  return rows.map(({ pkg_key, bonded }) => {
    const basePkg = pkg_key.split('(')[0] ?? pkg_key;
    const planRow = mpcPlanMap.get(pkg_key) ?? planMap.get(basePkg);
    const planPerShift = planRow?.plan_per_shift ?? 0;
    const target = planRow ? Math.trunc(planRow.plan_per_shift * hourFraction) : 0;
    // % deviation from the pro-rated target at this hour slot:
    //   positive = ahead of pace, negative = behind pace
    const pct = target > 0 ? ((bonded - target) / target) * 100 : 0;
    return {
      package: pkg_key,
      plan_per_shift: planPerShift,
      bonded,
      target,
      pct,
    };
  });
}
