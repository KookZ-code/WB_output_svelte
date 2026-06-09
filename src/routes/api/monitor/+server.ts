import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { fetchWbReport, normId } from '$lib/server/wbReport';
import { resolveShift } from '$lib/server/handler-utils';
import type { MonitorResponse, MonitorRow } from '$lib/types/dashboard';

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);

  try {
    // Staleness rows from central.db + per-machine events from the WB Report
    // overlay (API center, MSSQL). Report failure degrades to empty events.
    const [mon, wbMap] = await Promise.all([
      mwGet<{ rows: Omit<MonitorRow, 'events'>[]; as_of: string; threshold_min: number }>(
        '/api/v1/wb-uph/monitor',
        { date, shift }
      ),
      fetchWbReport(date, shift).catch(() => new Map()),
    ]);

    const rows: MonitorRow[] = mon.rows.map((r) => ({
      ...r,
      events: wbMap.get(normId(r.machine_id))?.events ?? [],
    }));

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
