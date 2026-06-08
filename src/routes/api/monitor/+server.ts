import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveShift } from '$lib/server/handler-utils';
import { queryMonitor } from '$lib/server/queries/monitor';
import type { MonitorResponse } from '$lib/types/dashboard';

const THRESHOLD_MIN = 120;

export const GET: RequestHandler = async ({ url }) => {
  const { window: w } = resolveShift(url);

  // Server-local "now" in the same format as created_at ("YYYY-MM-DD HH:MM:SS")
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const nowTs = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
                `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const asOf  = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  try {
    const rows = queryMonitor(w, nowTs, THRESHOLD_MIN);
    const body: MonitorResponse = {
      rows,
      shift_label:   w.label,
      as_of:         asOf,
      threshold_min: THRESHOLD_MIN,
    };
    return json(body);
  } catch (e) {
    error(503, `DB error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
