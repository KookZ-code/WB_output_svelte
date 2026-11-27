import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { fetchWbReport, normId } from '$lib/server/wbReport';
import { fetchLiveMachines, withLiveEvent } from '$lib/server/liveMachines';
import { resolveShift } from '$lib/server/handler-utils';
import type { LiveMachine, MonitorResponse, MonitorRow } from '$lib/types/dashboard';

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);

  try {
    // Staleness rows from central.db, per-machine events from the WB Report overlay,
    // and live job status. Report/live failure degrades to empty events / no live status.
    const [mon, wbMap, liveMap] = await Promise.all([
      mwGet<{ rows: Omit<MonitorRow, 'events' | 'live'>[]; as_of: string; threshold_min: number }>(
        '/api/v1/wb-uph/monitor',
        { date, shift }
      ),
      fetchWbReport(date, shift).catch(() => new Map()),
      fetchLiveMachines().catch(() => new Map<string, LiveMachine>()),
    ]);

    const rows: MonitorRow[] = mon.rows.map((r) => {
      const id = normId(r.machine_id);
      const live = liveMap.get(id) ?? null;
      return {
        ...r,
        events: withLiveEvent(wbMap.get(id)?.events ?? [], live),
        live,
      };
    });

    const body: MonitorResponse = {
      rows,
      shift_label: w.label,
      as_of: mon.as_of,
      threshold_min: mon.threshold_min,
    };
    return json(body);
  } catch (e) {
    if (e instanceof MiddlewareError) error(502, e.message);
    error(503, `API error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
