import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { displayToDb, parsePkgFilter, resolveShift } from '$lib/server/handler-utils';
import { hourLabel } from '$lib/server/shift';
import type { HourlyResponse } from '$lib/types/dashboard';

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);
  const plan = getPlan();
  const pkgFilter = parsePkgFilter(url).map((p) => displayToDb(p, plan.displayNames));
  const packages = pkgFilter.length ? pkgFilter.join(',') : undefined;

  let mw: { packages: Record<string, number[]> };
  try {
    mw = await mwGet<{ packages: Record<string, number[]> }>('/api/v1/wb-uph/hourly', {
      date,
      shift,
      packages,
    });
  } catch (e) {
    error(e instanceof MiddlewareError ? 502 : 500, e instanceof Error ? e.message : String(e));
  }

  const n = w.hours.length;
  // Lookup priority: mpcPlanMap by full MPC key → planMap by base name (strip
  // "(CODE)" suffix), so plain Excel rows still contribute to the target.
  const lookup = (k: string) => {
    const base = k.split('(')[0] ?? k;
    return plan.mpcPlanMap.get(k) ?? plan.planMap.get(base);
  };
  const totalTarget =
    pkgFilter.length === 0
      ? plan.rows.reduce((s, r) => s + r.plan_per_shift, 0)
      : pkgFilter.map(lookup).reduce((s, r) => s + (r?.plan_per_shift ?? 0), 0);

  const targetCumulative = Array.from({ length: n }, (_, i) =>
    Math.trunc((totalTarget * (i + 1)) / n)
  );
  const hours = w.hours.map(hourLabel);

  const body: HourlyResponse = { hours, target_cumulative: targetCumulative, packages: mw.packages };
  return json(body);
};
