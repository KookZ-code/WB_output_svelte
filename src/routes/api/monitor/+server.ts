import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { resolveShift } from '$lib/server/handler-utils';
import type { MonitorResponse, MonitorRow } from '$lib/types/dashboard';

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);

  try {
    // `as_of` / `threshold_min` are computed server-side (API center clock); the
    // staleness rows are already sorted. shift_label is the only local addition.
    const data = await mwGet<{ rows: MonitorRow[]; as_of: string; threshold_min: number }>(
      '/api/v1/wb-uph/monitor',
      { date, shift }
    );
    const body: MonitorResponse = {
      rows: data.rows,
      shift_label: w.label,
      as_of: data.as_of,
      threshold_min: data.threshold_min,
    };
    return json(body);
  } catch (e) {
    if (e instanceof MiddlewareError) error(502, e.message);
    error(503, `API error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
