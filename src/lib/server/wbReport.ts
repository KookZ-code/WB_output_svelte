// Server-only helper for the WB Report overlay (utilisation + events).
// Sourced from the API center's /api/v1/wb/report (MSSQL) via mwGet — shared by
// the machines and monitor routes so the fetch/normalisation lives in one place.

import { mwGet } from '$lib/server/middleware';
import type { WbEvent } from '$lib/types/dashboard';

export interface WbReportMachine {
  machine_id: string;
  util_pct: number;
  events: WbEvent[];
}

/** Machine-ID normalisation: WB Report uses "W/B # 334R", the output monitor uses
 *  "WB334R". Strip everything except letters/digits and uppercase → same key. */
export function normId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** Fetch the WB shift report and index machines (util + events) by normalised id.
 *  Caller should `.catch()` to degrade gracefully when the report is unavailable. */
export async function fetchWbReport(date: string, shift: 'D' | 'N'): Promise<Map<string, WbReportMachine>> {
  const shiftFull = shift === 'D' ? 'Day' : 'Night';
  const data = await mwGet<{ machines?: WbReportMachine[] }>('/api/v1/wb/report', {
    date,
    shift: shiftFull,
    packages: '__ALL__',
  });

  const map = new Map<string, WbReportMachine>();
  for (const m of data.machines ?? []) {
    map.set(normId(m.machine_id), m);
  }
  return map;
}
