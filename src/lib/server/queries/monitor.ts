// Machine staleness monitor query.
//
// Returns two sets of machines for the current shift:
//   1. Machines that HAVE scanned this shift — with their latest scan time.
//   2. Machines that scanned in the 48 h BEFORE the shift (recently active)
//      but have NOT scanned this shift yet → reported as "no_data".
//
// Threshold rules (applied at the API layer, not here):
//   active  : since_min ≤ threshold
//   stale   : since_min > threshold
//   no_data : no scan in current shift at all

import { db } from '../db';
import type { ShiftWindow } from '../shift';
import type { MonitorRow } from '$lib/types/dashboard';

// "YYYY-MM-DD HH:MM:SS" → minutes since epoch (for arithmetic)
function toMin(ts: string): number {
  const y = +ts.slice(0, 4), mo = +ts.slice(5, 7), d = +ts.slice(8, 10);
  const h = +ts.slice(11, 13), m = +ts.slice(14, 16), s = +ts.slice(17, 19);
  return (Date.UTC(y, mo - 1, d, h, m, s) / 60_000);
}

export function queryMonitor(
  w: ShiftWindow,
  nowTs: string,          // "YYYY-MM-DD HH:MM:SS" — server local time
  thresholdMin: number
): MonitorRow[] {
  const conn = db();
  const nowMin = toMin(nowTs);

  // ── 1. Machines that scanned in current shift ────────────────────────────
  const active = conn.prepare(`
    SELECT machine_id,
           MAX(created_at) AS last_scan_ts,
           COALESCE(
               (SELECT COALESCE(package_mpc,
                    CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9
                         THEN package||'('||SUBSTR(mpc,7,3)||')'
                         ELSE package END)
                FROM uph_records r2
                WHERE r2.machine_id = r1.machine_id
                  AND r2.voided     = 0
                  AND r2.created_at >= @start
                  AND r2.created_at <= @end
                ORDER BY r2.created_at DESC LIMIT 1),
               ''
           ) AS package
    FROM uph_records r1
    WHERE voided     = 0
      AND created_at >= @start
      AND created_at <= @end
    GROUP BY machine_id
  `).all({ start: w.start, end: w.end }) as Array<{
    machine_id: string; last_scan_ts: string; package: string;
  }>;

  const activeIds = new Set(active.map(r => r.machine_id));

  // ── 2. Recently-active machines that HAVEN'T scanned this shift ──────────
  // Lookback: 48 h before shift start (covers 2 previous shifts)
  const noData = conn.prepare(`
    SELECT machine_id,
           COALESCE(
               (SELECT COALESCE(package_mpc,
                    CASE WHEN mpc IS NOT NULL AND LENGTH(mpc)>=9
                         THEN package||'('||SUBSTR(mpc,7,3)||')'
                         ELSE package END)
                FROM uph_records r2
                WHERE r2.machine_id = r1.machine_id
                  AND r2.voided     = 0
                ORDER BY r2.created_at DESC LIMIT 1),
               ''
           ) AS package
    FROM uph_records r1
    WHERE voided     = 0
      AND created_at >= @lookback
      AND created_at <  @start
    GROUP BY machine_id
  `).all({
    lookback: w.start.slice(0, 10) + ' 00:00:00', // beginning of shift's calendar day minus ~
    start:    w.start,
  }) as Array<{ machine_id: string; package: string }>;

  // ── Build result ──────────────────────────────────────────────────────────
  const rows: MonitorRow[] = [];

  for (const r of active) {
    const sinceMin = Math.floor(nowMin - toMin(r.last_scan_ts));
    rows.push({
      machine_id:   r.machine_id,
      package:      r.package,
      last_scan_ts: r.last_scan_ts,
      since_min:    sinceMin,
      status:       sinceMin <= thresholdMin ? 'active' : 'stale',
    });
  }

  for (const r of noData) {
    if (activeIds.has(r.machine_id)) continue; // already counted above
    rows.push({
      machine_id:   r.machine_id,
      package:      r.package,
      last_scan_ts: null,
      since_min:    null,
      status:       'no_data',
    });
  }

  // Sort: no_data → stale (worst first) → active (most stale first)
  rows.sort((a, b) => {
    const order = { no_data: 0, stale: 1, active: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (b.since_min ?? 9999) - (a.since_min ?? 9999);
  });

  return rows;
}
