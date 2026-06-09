import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { displayToDb, parsePkgFilter, resolveShift } from '$lib/server/handler-utils';
import type { PackageRow } from '$lib/types/dashboard';

// Raw per-pkg_key bonded totals from the API center. Plan merge / target / pct
// (formerly inside queryPackages) is applied here so the Excel plan stays frontend-side.
interface MwPackage {
  package: string;
  bonded: number;
}

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);
  const plan = getPlan();
  const pkgFilter = parsePkgFilter(url).map((p) => displayToDb(p, plan.displayNames));
  const packages = pkgFilter.length ? pkgFilter.join(',') : undefined;

  const hourParam = url.searchParams.get('hour');
  const hour =
    hourParam && /^\d+$/.test(hourParam) ? Number(hourParam) : (w.hours[w.hours.length - 1] ?? 18);
  const slotIdx = Math.max(0, w.hours.indexOf(hour));
  const hourFraction = (slotIdx + 1) / w.hours.length;

  let rows: MwPackage[];
  try {
    rows = await mwGet<MwPackage[]>('/api/v1/wb-uph/packages', {
      date,
      shift,
      hour: String(hour),
      packages,
    });
  } catch (e) {
    error(e instanceof MiddlewareError ? 502 : 500, e instanceof Error ? e.message : String(e));
  }

  // When a pkg_key has no MPC-specific plan, variants sharing a base (e.g.
  // "8SOIC(C2X)" + "8SOIC(CYX)" → "8SOIC") are summed and compared to the base plan.
  const mpcRows: PackageRow[] = [];
  const baseMerge = new Map<string, PackageRow>();

  for (const { package: pkg_key, bonded } of rows) {
    const basePkg = pkg_key.split('(')[0] ?? pkg_key;
    const mpcPlanRow = plan.mpcPlanMap.get(pkg_key);

    if (mpcPlanRow) {
      const target = Math.trunc(mpcPlanRow.plan_per_shift * hourFraction);
      const pct = target > 0 ? ((bonded - target) / target) * 100 : 0;
      mpcRows.push({ package: pkg_key, plan_per_shift: mpcPlanRow.plan_per_shift, bonded, target, pct });
    } else {
      const planRow = plan.planMap.get(basePkg);
      const planPerShift = planRow?.plan_per_shift ?? 0;
      const target = planRow ? Math.trunc(planPerShift * hourFraction) : 0;
      const existing = baseMerge.get(basePkg);
      if (existing) {
        existing.bonded += bonded;
        existing.pct = existing.target > 0 ? ((existing.bonded - existing.target) / existing.target) * 100 : 0;
      } else {
        const pct = target > 0 ? ((bonded - target) / target) * 100 : 0;
        baseMerge.set(basePkg, { package: basePkg, plan_per_shift: planPerShift, bonded, target, pct });
      }
    }
  }

  const result = [...mpcRows, ...baseMerge.values()].sort((a, b) => b.bonded - a.bonded);
  return json(result);
};
