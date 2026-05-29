import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { queryMachines } from '$lib/server/queries/machines';
import { displayToDb, resolveShift } from '$lib/server/handler-utils';

export const GET: RequestHandler = async ({ url }) => {
  const { window: w } = resolveShift(url);
  const plan = getPlan();

  const pkg = url.searchParams.get('package');
  if (!pkg) error(400, 'Missing required query param: package');

  const hourParam = url.searchParams.get('hour');
  const hour =
    hourParam && /^\d+$/.test(hourParam) ? Number(hourParam) : (w.hours[w.hours.length - 1] ?? 18);

  const dbPkg = displayToDb(pkg, plan.displayNames);

  try {
    const rows = queryMachines(w, hour, dbPkg, plan.planMap, plan.mpcPlanMap);
    return json(rows);
  } catch (e) {
    error(503, `DB error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
