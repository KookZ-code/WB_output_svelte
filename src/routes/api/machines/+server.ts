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

    // Required M/C = ⌈plan_per_shift / (target_uph × shift_hours)⌉
    const base = dbPkg.split('(')[0] ?? dbPkg;
    const planRow = plan.mpcPlanMap.get(dbPkg) ?? plan.planMap.get(base);
    const targetUph = planRow?.uph_target ?? 0;
    const planPerShift = planRow?.plan_per_shift ?? 0;
    const shiftHours = w.hours.length;
    const required_mc =
      targetUph > 0 && planPerShift > 0
        ? Math.ceil(planPerShift / (targetUph * shiftHours))
        : 0;

    return json({ rows, required_mc });
  } catch (e) {
    error(503, `DB error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
