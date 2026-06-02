// Port of WB_Dashboard/src/db.rs query_machines

import { db } from '../db';
import { slotEndForHour, type ShiftWindow } from '../shift';
import type { MachineRow, PlanRow } from '$lib/types/dashboard';

export function queryMachines(
  w: ShiftWindow,
  hour: number,
  packageKey: string,
  planMap: Map<string, PlanRow>,
  mpcPlanMap: Map<string, PlanRow>
): MachineRow[] {
  const slotIdx = Math.max(0, w.hours.indexOf(hour));
  const slotEnd = slotEndForHour(w, slotIdx, hour);
  const hourFraction = (slotIdx + 1) / w.hours.length;

  const baseUphTarget = planMap.get(packageKey)?.uph_target ?? 0;
  const targetBonded = planMap.get(packageKey)
    ? Math.trunc((planMap.get(packageKey)?.plan_per_shift ?? 0) * hourFraction)
    : 0;

  const sql = `SELECT machine_id,
            MAX(badge_no)                AS badge_no,
            AVG(avg_uph)                 AS avg_uph,
            COALESCE(SUM(delta), 0)      AS bonded,
            MAX(pkg_mpc)                 AS pkg_mpc
     FROM (
         SELECT machine_id, lot_id,
                MAX(badge_no)            AS badge_no,
                AVG(CASE WHEN uph > 0 THEN uph END) AS avg_uph,
                COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END) AS pkg_mpc,
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
         WHERE voided      = 0
           AND COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END) = @pkg
           AND created_at >= @start
           AND created_at <= @slot_end
         GROUP BY machine_id, lot_id
     )
     GROUP BY machine_id
     ORDER BY bonded DESC`;

  const rows = db()
    .prepare(sql)
    .all({ start: w.start, slot_end: slotEnd, pkg: packageKey }) as Array<{
    machine_id: string;
    badge_no: string;
    avg_uph: number;
    bonded: number;
    pkg_mpc: string | null;
  }>;

  // elapsed_hours = number of complete 1-hour slots up to and including the
  // selected slot (slotIdx is 0-based, so slot 0 = first hour = 1 elapsed hour).
  const elapsedHours = slotIdx + 1;

  return rows.map((r) => {
    const uphTarget = r.pkg_mpc ? mpcPlanMap.get(r.pkg_mpc)?.uph_target ?? baseUphTarget : baseUphTarget;
    // Expected cumulative output = target UPH × hours elapsed in shift so far.
    const expectedBonded = uphTarget * elapsedHours;
    const vsOutputPct =
      expectedBonded > 0 ? ((r.bonded - expectedBonded) / expectedBonded) * 100 : 0;
    return {
      machine_id: r.machine_id,
      badge_no: r.badge_no,
      target_uph: uphTarget,
      uph: r.avg_uph,
      bonded_unit: r.bonded,
      vs_output_pct: vsOutputPct,
    };
  });
}
