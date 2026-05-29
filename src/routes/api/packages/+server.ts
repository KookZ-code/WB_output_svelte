import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { queryPackages } from '$lib/server/queries/packages';
import { displayToDb, parsePkgFilter, resolveShift } from '$lib/server/handler-utils';

export const GET: RequestHandler = async ({ url }) => {
  const { window: w } = resolveShift(url);
  const plan = getPlan();
  const pkgFilter = parsePkgFilter(url).map((p) => displayToDb(p, plan.displayNames));

  const hourParam = url.searchParams.get('hour');
  const hour =
    hourParam && /^\d+$/.test(hourParam) ? Number(hourParam) : (w.hours[w.hours.length - 1] ?? 18);

  try {
    const rows = queryPackages(w, hour, plan.planMap, plan.mpcPlanMap, pkgFilter);
    return json(rows);
  } catch (e) {
    error(503, `DB error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
