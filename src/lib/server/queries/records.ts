// Port of WB_Dashboard/src/db.rs query_records
// Uses LAG() window function for delta_bonded within a lot.

import { db } from '../db';
import type { ShiftWindow } from '../shift';
import type { RawRecord } from '$lib/types/dashboard';

export function queryRecords(w: ShiftWindow, machineId: string, packageKey: string): RawRecord[] {
  const sql = `SELECT
         created_at,
         lot_id,
         COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END)   AS pkg,
         uph,
         bonded_unit,
         bonded_unit - COALESCE(
             LAG(bonded_unit) OVER (
                 PARTITION BY lot_id
                 ORDER BY created_at
             ),
             (SELECT bonded_unit FROM uph_records pre2
              WHERE pre2.machine_id = @machine
                AND pre2.lot_id     = uph_records.lot_id
                AND pre2.voided     = 0
                AND pre2.created_at < @start
              ORDER BY pre2.created_at DESC LIMIT 1),
             CASE
                 WHEN (julianday(created_at) - julianday(@start)) > 0
                  AND bonded_unit / ((julianday(created_at) - julianday(@start)) * 24.0) > uph * 2
                 THEN bonded_unit
                 ELSE 0
             END
         )                                AS delta_bonded,
         COALESCE(badge_no, '')           AS badge_no
     FROM uph_records
     WHERE voided     = 0
       AND machine_id = @machine
       AND COALESCE(package_mpc, CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9 THEN package||'('||SUBSTR(mpc,7,3)||')' ELSE package END) = @pkg
       AND created_at >= @start
       AND created_at <= @end
     ORDER BY created_at ASC`;

  const rows = db()
    .prepare(sql)
    .all({ machine: machineId, pkg: packageKey, start: w.start, end: w.end }) as Array<{
    created_at: string;
    lot_id: string;
    pkg: string;
    uph: number;
    bonded_unit: number;
    delta_bonded: number;
    badge_no: string;
  }>;

  return rows.map((r) => ({
    created_at: r.created_at,
    lot_id: r.lot_id,
    package_mpc: r.pkg.trim(),
    uph: r.uph,
    bonded_unit: r.bonded_unit,
    delta_bonded: r.delta_bonded,
    badge_no: r.badge_no,
  }));
}
