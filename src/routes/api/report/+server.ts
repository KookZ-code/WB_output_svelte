import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { fetchWip, lookupWip, lookupDoi, lookupPlan, lookupOrder, type WipData } from '$lib/server/wip';
import { fetchWbReport, normId, type WbReportMachine } from '$lib/server/wbReport';
import { displayToDb, resolveShift } from '$lib/server/handler-utils';
import type { PackageRow, MachineRow, ReportMachineRow, ReportData } from '$lib/types/dashboard';

interface MwPackage {
  package: string;
  bonded: number;
}

interface MwMachine {
  machine_id: string;
  badge_no: string;
  uph: number;
  max_uph: number | null;
  bonded_unit: number;
  last_scan_ts: string | null;
  pkg_mpc: string;
}

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);
  const plan = getPlan();

  let summary: { total_bonded: number };
  let packageRows: MwPackage[];
  let wip: WipData;
  let wbMap: Map<string, WbReportMachine>;

  try {
    // Fetch all data in parallel
    [summary, packageRows, wip, wbMap] = await Promise.all([
      mwGet<{ total_bonded: number }>('/api/v1/wb-uph/summary', { date, shift }),
      mwGet<MwPackage[]>('/api/v1/wb-uph/packages', { date, shift }),
      fetchWip().catch((): WipData => ({
        byMpc: new Map(),
        byNorm: new Map(),
        orderByMpc: new Map(),
        orderByNorm: new Map(),
        totalDailyPlan: 0,
        totalDailyPlanQfn: 0,
        totalDailyPlanLead: 0,
      })),
      fetchWbReport(date, shift).catch(() => new Map<string, WbReportMachine>()),
    ]);
  } catch (e) {
    error(e instanceof MiddlewareError ? 502 : 500, e instanceof Error ? e.message : String(e));
  }

  // Build package list with merged plans
  const mpcRows: PackageRow[] = [];
  const baseMerge = new Map<string, PackageRow>();

  for (const { package: pkg_key, bonded } of packageRows) {
    const basePkg = pkg_key.split('(')[0] ?? pkg_key;
    const mpcPlanRow = plan.mpcPlanMap.get(pkg_key);

    if (mpcPlanRow) {
      const target = mpcPlanRow.plan_per_shift;
      const pct = target > 0 ? ((bonded - target) / target) * 100 : 0;
      mpcRows.push({ package: pkg_key, plan_per_shift: mpcPlanRow.plan_per_shift, bonded, target, pct });
    } else {
      const planRow = plan.planMap.get(basePkg);
      const planPerShift = planRow?.plan_per_shift ?? 0;
      const target = planPerShift;
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

  const result = [...mpcRows, ...baseMerge.values()];

  // Overlay WireBond WIP/DOI
  for (const row of result) {
    row.wip = lookupWip(row.package, wip);
    row.doi = lookupDoi(row.package, wip);
    row.a01Seq = lookupOrder(row.package, wip);
    const dailyPlan = lookupPlan(row.package, wip);
    if (dailyPlan != null && dailyPlan > 0) {
      row.plan_per_shift = Math.round(dailyPlan / 2);
      row.target = row.plan_per_shift;
      row.pct = row.target > 0 ? ((row.bonded - row.target) / row.target) * 100 : 0;
    }
  }

  // Sort by A01 order
  result.sort((a, b) => (a.a01Seq ?? Infinity) - (b.a01Seq ?? Infinity));

  // Fetch machines for each package + aggregate lost time
  const packagesWithMachines = await Promise.all(
    result.map(async (pkg) => {
      try {
        const dbPkg = displayToDb(pkg.package, plan.displayNames);
        const machineRows = await mwGet<MwMachine[]>('/api/v1/wb-uph/machines', {
          date,
          shift,
          package: dbPkg,
        });

        const base = dbPkg.split('(')[0] ?? dbPkg;
        const planRow = plan.mpcPlanMap.get(dbPkg) ?? plan.planMap.get(base);
        const baseUphTarget = plan.planMap.get(base)?.uph_target ?? 0;
        const targetUph = planRow?.uph_target ?? 0;

        // Merge utilization + events + calculate lost time
        const machines: ReportMachineRow[] = machineRows.map((r) => {
          const uphTarget = r.pkg_mpc
            ? plan.mpcPlanMap.get(r.pkg_mpc)?.uph_target ?? baseUphTarget
            : baseUphTarget;

          const wbReport = wbMap.get(normId(r.machine_id));
          const events = wbReport?.events ?? [];

          // Aggregate lost time by job type
          const lost_group_mins: Record<string, number> = {};
          for (const ev of events) {
            const jt = (ev.job_type || '').toUpperCase();
            let group = jt;

            // Map job types to report groups
            if (/M\/C DOWN|ENGINEERING DOWN|FACILITY DOWN/.test(jt)) {
              group = 'DOWN';
            } else if (/SETUP|CLEAN MOLD|CHANGE CAP/.test(jt)) {
              group = 'SETUP';
            } else if (/IDLE|WAIT/.test(ev.des_job || '')) {
              group = 'IDLE';
            } else if (jt === 'SETUP BY OPERATOR') {
              group = 'SBO';
            } else if (jt === 'CONVERT') {
              group = 'CONVERT';
            } else if (jt === 'PM') {
              group = 'PM';
            }

            lost_group_mins[group] = (lost_group_mins[group] ?? 0) + ev.dur_min;
          }

          const expectedPerMachine = pkg.bonded > 0 && machineRows.length > 0
            ? Math.trunc(pkg.target / machineRows.length)
            : 0;

          return {
            machine_id: r.machine_id,
            badge_no: r.badge_no,
            target_uph: uphTarget,
            uph: r.uph,
            max_uph: r.max_uph ?? null,
            bonded_unit: r.bonded_unit,
            last_scan_ts: r.last_scan_ts,
            util_pct: wbReport?.util_pct ?? null,
            events,
            vs_output_pct: expectedPerMachine > 0
              ? ((r.bonded_unit - expectedPerMachine) / expectedPerMachine) * 100
              : 0,
            expected_output: expectedPerMachine,
            lost_group_mins,
          };
        });

        return { ...pkg, machines };
      } catch {
        return { ...pkg, machines: [] };
      }
    })
  );

  // Calculate target shift total from plan
  const targetShift = result.reduce((s, r) => s + r.plan_per_shift, 0);
  const achievementPct = targetShift > 0 ? (summary.total_bonded / targetShift) * 100 : 0;

  const body: ReportData = {
    date,
    shift,
    shift_label: w.label,
    window_start: w.start,
    window_end: w.end,
    total_bonded: summary.total_bonded,
    target_shift: targetShift,
    achievement_pct: achievementPct,
    packages: packagesWithMachines,
  };

  return json(body);
};
