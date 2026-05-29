// Port of WB_Dashboard/src/db.rs query_summary
//
// SQL is copied verbatim — it computes per (machine, lot) the delta from a
// pre-shift baseline (with carry-over heuristic when no pre-shift record exists),
// then aggregates total bonded / distinct machines / avg uph for the shift.

import { db, buildPkgClause } from '../db';
import type { ShiftWindow } from '../shift';

export interface SummaryQueryRow {
  total_bonded: number;
  active_machines: number;
  avg_uph: number;
}

export function querySummary(w: ShiftWindow, pkgFilter: string[]): SummaryQueryRow {
  const pkgClause = buildPkgClause(pkgFilter);
  const sql = `SELECT
        COALESCE(SUM(delta), 0)       AS total_bonded,
        COUNT(DISTINCT machine_id)    AS machines,
        COALESCE(AVG(avg_uph), 0)     AS avg_uph
     FROM (
         SELECT machine_id, lot_id,
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
                       AND f.created_at <= @end
                     ORDER BY f.created_at ASC LIMIT 1)
                )) AS delta,
                AVG(uph) AS avg_uph
         FROM uph_records main
         WHERE voided = 0
           AND created_at >= @start
           AND created_at <= @end
           ${pkgClause}
         GROUP BY machine_id, lot_id
     )`;

  const row = db().prepare(sql).get({ start: w.start, end: w.end }) as
    | { total_bonded: number; machines: number; avg_uph: number }
    | undefined;
  if (!row) return { total_bonded: 0, active_machines: 0, avg_uph: 0 };
  return {
    total_bonded: row.total_bonded,
    active_machines: row.machines,
    avg_uph: row.avg_uph,
  };
}
