import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { queryHourly } from '$lib/server/queries/hourly';
import { displayToDb, parsePkgFilter, resolveShift } from '$lib/server/handler-utils';
import { hourLabel } from '$lib/server/shift';
import type { HourlyResponse } from '$lib/types/dashboard';

export const GET: RequestHandler = async ({ url }) => {
  const { window: w } = resolveShift(url);
  const plan = getPlan();
  const pkgFilter = parsePkgFilter(url).map((p) => displayToDb(p, plan.displayNames));

  let pkgMap: Map<string, number[]>;
  try {
    pkgMap = queryHourly(w, pkgFilter);
  } catch (e) {
    error(503, `DB error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const n = w.hours.length;
  const totalTarget =
    pkgFilter.length === 0
      ? plan.rows.reduce((s, r) => s + r.plan_per_shift, 0)
      : pkgFilter
          .map((k) => plan.mpcPlanMap.get(k) ?? plan.planMap.get(k))
          .reduce((s, r) => s + (r?.plan_per_shift ?? 0), 0);

  const targetCumulative = Array.from({ length: n }, (_, i) =>
    Math.trunc((totalTarget * (i + 1)) / n)
  );
  const hours = w.hours.map(hourLabel);
  const packages: Record<string, number[]> = Object.fromEntries(pkgMap);

  const body: HourlyResponse = { hours, target_cumulative: targetCumulative, packages };
  return json(body);
};
