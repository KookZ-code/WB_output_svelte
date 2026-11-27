// Server-only helper for live machine status.
// Sourced from the API center's /api/v1/live/machines via mwGet. Its `status` field
// (Running / Setup / M/C Down / Convert) drives the by-machine status badge; the
// WB Report events are still used only for the "Events in Shift" column.

import { mwGet } from '$lib/server/middleware';
import { normId } from '$lib/server/wbReport';
import type { LiveMachine, WbEvent } from '$lib/types/dashboard';

/** Fetch live status for every machine, indexed by normalised id (same key as normId()).
 *  Caller should `.catch()` so the table still renders when the live feed is down. */
export async function fetchLiveMachines(): Promise<Map<string, LiveMachine>> {
  const data = await mwGet<LiveMachine[]>('/api/v1/live/machines');

  const map = new Map<string, LiveMachine>();
  for (const m of data) {
    map.set(normId(m.code_machine), m);
  }
  return map;
}

/** Add the live job to the Events column when the machine is not running but the WB report
 *  has no open event for it. Without this, a DOWN shown in the status badge can be missing
 *  from "Events in Shift" because the report lags behind the live feed. The report's own
 *  open events are kept as they are, so the same job is not listed twice. */
export function withLiveEvent(events: WbEvent[], live: LiveMachine | null): WbEvent[] {
  if (!live || live.status.toLowerCase() === 'running') return events;
  if (!live.job_type || !live.started_at) return events;
  if (events.some((e) => e.is_open || !e.t_end)) return events;

  const liveEvent: WbEvent = {
    job_type: live.job_type,
    // The "Z" suffix is a mislabel: started_at is already shop-floor time (it matches the
    // clock and elapsed_min), so take HH:MM as-is, the same way last_scan_ts is shown.
    t_start: live.started_at.slice(11, 16),
    t_end: '',
    des_job: live.symptom ?? '',
    dur_min: live.elapsed_min,
    is_open: true,
  };
  return [liveEvent, ...events];
}
