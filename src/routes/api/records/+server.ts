import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { displayToDb, resolveShift } from '$lib/server/handler-utils';
import type { RecordsResponse } from '$lib/types/dashboard';

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift } = resolveShift(url);
  const plan = getPlan();

  const machineId = url.searchParams.get('machine_id');
  const pkg = url.searchParams.get('package');
  if (!machineId) error(400, 'Missing required query param: machine_id');
  if (!pkg) error(400, 'Missing required query param: package');

  const dbPkg = displayToDb(pkg, plan.displayNames);

  try {
    // Fully plan-independent — the API returns { current, prev_tail } directly.
    const data = await mwGet<RecordsResponse>('/api/v1/wb-uph/records', {
      date,
      shift,
      machine_id: machineId,
      package: dbPkg,
    });
    return json(data);
  } catch (e) {
    if (e instanceof MiddlewareError) error(502, e.message);
    error(503, `API error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
