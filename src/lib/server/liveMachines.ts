// Server-only helper for live machine status.
// Sourced from the API center's /api/v1/live/machines via mwGet. Its `status` field
// (Running / Setup / M/C Down / Convert) drives the by-machine status badge; the
// WB Report events are still used only for the "Events in Shift" column.

import { mwGet } from '$lib/server/middleware';
import { normId } from '$lib/server/wbReport';
import type { LiveMachine } from '$lib/types/dashboard';

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
