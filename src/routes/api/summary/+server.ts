import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { querySummary } from '$lib/server/queries/summary';
import { displayToDb, parsePkgFilter, resolveShift } from '$lib/server/handler-utils';
import type { SummaryResponse } from '$lib/types/dashboard';

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);
  const plan = getPlan();
  const pkgFilter = parsePkgFilter(url).map((p) => displayToDb(p, plan.displayNames));

  let data: ReturnType<typeof querySummary>;
  try {
    data = querySummary(w, pkgFilter);
  } catch (e) {
    error(503, `DB error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Target totals — sum of plan_per_shift, average of uph_target
  let targetShift: number;
  let targetAvgUph: number;
  if (pkgFilter.length === 0) {
    const n = plan.rows.length;
    targetShift = plan.rows.reduce((s, r) => s + r.plan_per_shift, 0);
    const sumU = plan.rows.reduce((s, r) => s + r.uph_target, 0);
    targetAvgUph = n > 0 ? sumU / n : 0;
  } else {
    const plans = pkgFilter
      .map((k) => plan.mpcPlanMap.get(k) ?? plan.planMap.get(k))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    targetShift = plans.reduce((s, r) => s + r.plan_per_shift, 0);
    const sumU = plans.reduce((s, r) => s + r.uph_target, 0);
    targetAvgUph = plans.length > 0 ? sumU / plans.length : 0;
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
    avg_uph: data.avg_uph,
    target_avg_uph: targetAvgUph,
  };
  return json(body);
};
