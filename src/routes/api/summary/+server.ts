import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { displayToDb, parsePkgFilter, resolveShift } from '$lib/server/handler-utils';
import type { SummaryResponse } from '$lib/types/dashboard';

// Raw summary numbers from the API center (plan overlay is applied below).
interface MwSummary {
  total_bonded: number;
  active_machines: number;
  active_operators: number;
}

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);
  const plan = getPlan();
  const pkgFilter = parsePkgFilter(url).map((p) => displayToDb(p, plan.displayNames));
  const packages = pkgFilter.length ? pkgFilter.join(',') : undefined;

  let data: MwSummary;
  try {
    data = await mwGet<MwSummary>('/api/v1/wb-uph/summary', { date, shift, packages });
  } catch (e) {
    error(e instanceof MiddlewareError ? 502 : 500, e instanceof Error ? e.message : String(e));
  }

  // Daily total = this shift + the other shift of the same date.
  const otherShift = shift === 'D' ? 'N' : 'D';
  let otherBonded = 0;
  try {
    otherBonded = (await mwGet<MwSummary>('/api/v1/wb-uph/summary', { date, shift: otherShift, packages }))
      .total_bonded;
  } catch {
    // non-fatal — daily total degrades to this shift only
  }
  const daily_bonded = data.total_bonded + otherBonded;

  // Target shift total — sum of plan_per_shift for the relevant packages.
  let targetShift: number;
  if (pkgFilter.length === 0) {
    targetShift = plan.rows.reduce((s, r) => s + r.plan_per_shift, 0);
  } else {
    // mpcPlanMap by full MPC key, falling back to planMap by base name.
    const plans = pkgFilter
      .map((k) => {
        const base = k.split('(')[0] ?? k;
        return plan.mpcPlanMap.get(k) ?? plan.planMap.get(base);
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    targetShift = plans.reduce((s, r) => s + r.plan_per_shift, 0);
  }

  const achievementPct = targetShift > 0 ? (data.total_bonded / targetShift) * 100 : 0;

  const body: SummaryResponse = {
    date,
    shift,
    shift_label: w.label,
    window_start: w.start,
    window_end: w.end,
    total_bonded: data.total_bonded,
    target_shift: targetShift,
    achievement_pct: achievementPct,
    active_machines: data.active_machines,
    active_operators: data.active_operators,
    daily_bonded,
  };
  return json(body);
};
