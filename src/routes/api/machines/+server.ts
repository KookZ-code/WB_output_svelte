import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { displayToDb, resolveShift } from '$lib/server/handler-utils';
import { fetchWbReport, normId, type WbReportMachine } from '$lib/server/wbReport';

// Raw per-machine rows from the API center (plan target/% applied below).
interface MwMachine {
  machine_id: string;
  badge_no: string;
  uph: number;
  bonded_unit: number;
  last_scan_ts: string | null;
  pkg_mpc: string;
}

// ─────────────────────────────────────────────────────────────────────────
export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);
  const plan = getPlan();

  const pkg = url.searchParams.get('package');
  if (!pkg) error(400, 'Missing required query param: package');

  const hourParam = url.searchParams.get('hour');
  const hour =
    hourParam && /^\d+$/.test(hourParam) ? Number(hourParam) : (w.hours[w.hours.length - 1] ?? 18);

  const dbPkg = displayToDb(pkg, plan.displayNames);

  try {
    // Raw machine rows from the API center + WB Report overlay, in parallel.
    const [rows, wbMap] = await Promise.all([
      mwGet<MwMachine[]>('/api/v1/wb-uph/machines', { date, shift, hour: String(hour), package: dbPkg }),
      fetchWbReport(date, shift).catch(() => new Map<string, WbReportMachine>()),
    ]);

    // Per-row UPH target: prefer mpc plan for the row's variant, fall back to base.
    const base = dbPkg.split('(')[0] ?? dbPkg;
    const planRow = plan.mpcPlanMap.get(dbPkg) ?? plan.planMap.get(base);
    const baseUphTarget = plan.planMap.get(dbPkg)?.uph_target ?? 0;
    const targetUph = planRow?.uph_target ?? 0;
    const planPerShift = planRow?.plan_per_shift ?? 0;
    const shiftHours = w.hours.length;
    const slotIdx = Math.max(0, w.hours.indexOf(hour));
    const hourFraction = (slotIdx + 1) / shiftHours;

    // Merge utilisation + events + per-row UPH target into each row.
    const mergedBase = rows.map((r) => {
      const uphTarget = r.pkg_mpc
        ? plan.mpcPlanMap.get(r.pkg_mpc)?.uph_target ?? baseUphTarget
        : baseUphTarget;
      return {
        machine_id: r.machine_id,
        badge_no: r.badge_no,
        target_uph: uphTarget,
        uph: r.uph,
        bonded_unit: r.bonded_unit,
        last_scan_ts: r.last_scan_ts,
        util_pct: wbMap.get(normId(r.machine_id))?.util_pct ?? null,
        events: wbMap.get(normId(r.machine_id))?.events ?? [],
      };
    });

    const required_mc =
      targetUph > 0 && planPerShift > 0
        ? Math.ceil(planPerShift / (targetUph * shiftHours))
        : 0;
    const target_bonded = Math.trunc(planPerShift * hourFraction);

    // vs_output_pct = (output - expected_per_machine) / expected_per_machine
    const expectedPerMachine =
      target_bonded > 0 && mergedBase.length > 0
        ? Math.trunc(target_bonded / mergedBase.length)
        : 0;
    const merged = mergedBase.map((r) => ({
      ...r,
      vs_output_pct:
        expectedPerMachine > 0
          ? ((r.bonded_unit - expectedPerMachine) / expectedPerMachine) * 100
          : 0,
    }));

    return json({ rows: merged, required_mc, target_bonded });
  } catch (e) {
    if (e instanceof MiddlewareError) error(502, e.message);
    error(503, `API error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
