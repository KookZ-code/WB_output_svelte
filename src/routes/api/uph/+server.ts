import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { mwGet, MiddlewareError } from '$lib/server/middleware';
import { displayToDb, resolveShift } from '$lib/server/handler-utils';
import { hourLabel } from '$lib/server/shift';
import { fetchWbReport, normId, type WbReportMachine } from '$lib/server/wbReport';
import type { UphHour, UphMachine, UphResponse } from '$lib/types/dashboard';

// Raw per-machine rows from the API center (same endpoint as /api/machines).
interface MwMachine {
  machine_id: string;
  badge_no: string;
  uph: number;
  max_uph: number | null;
  bonded_unit: number;
  last_scan_ts: string | null;
  pkg_mpc: string;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** "YYYY-MM-DD HH:MM" of local now, comparable with a slot start string. */
function nowStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// One API call per hour (fan-out) — cache briefly so re-selecting is cheap.
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; rows: MwMachine[] }>();

async function fetchHour(date: string, shift: string, hour: number, pkg: string): Promise<MwMachine[]> {
  const key = `${date}|${shift}|${hour}|${pkg}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const rows = await mwGet<MwMachine[]>('/api/v1/wb-uph/machines', {
    date,
    shift,
    hour: String(hour),
    package: pkg,
  });
  cache.set(key, { at: Date.now(), rows });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return rows;
}

export const GET: RequestHandler = async ({ url }) => {
  const { date, shift, window: w } = resolveShift(url);
  const plan = getPlan();

  const pkg = url.searchParams.get('package');
  if (!pkg) error(400, 'Missing required query param: package');
  const dbPkg = displayToDb(pkg, plan.displayNames);

  // Same lookup order as /api/hourly: full MPC key first, then base name.
  const lookupTarget = (k: string) =>
    plan.mpcPlanMap.get(k)?.uph_target ?? plan.planMap.get(k.split('(')[0] ?? k)?.uph_target ?? 0;
  const baseTarget = lookupTarget(dbPkg);
  const headlineTarget = baseTarget;

  // Slots that start after "now" are future (only possible in the live shift).
  const now = nowStr();
  const slotStart = (h: number) => {
    const d = shift === 'D' || h >= 7 ? w.start.slice(0, 10) : w.end.slice(0, 10);
    return `${d} ${pad(h)}:00`;
  };
  const isFuture = (h: number) => slotStart(h) > now;

  try {
    const [perHour, wbMap] = await Promise.all([
      Promise.all(w.hours.map((h) => (isFuture(h) ? Promise.resolve(null) : fetchHour(date, shift, h, dbPkg)))),
      fetchWbReport(date, shift).catch(() => new Map<string, WbReportMachine>()),
    ]);

    const hours: UphHour[] = w.hours.map((h, i) => {
      const rows = perHour[i];
      if (!rows) return { hour: h, label: hourLabel(h), future: true, meet: 0, not_meet: 0, machines: [] };

      const machines: UphMachine[] = rows.map((r) => {
        const target = r.pkg_mpc ? lookupTarget(r.pkg_mpc) || baseTarget : baseTarget;
        const wb = wbMap.get(normId(r.machine_id));
        return {
          machine_id: r.machine_id,
          badge_no: r.badge_no,
          uph: r.uph,
          target_uph: target,
          max_uph: r.max_uph ?? null,
          bonded_unit: r.bonded_unit,
          last_scan_ts: r.last_scan_ts,
          util_pct: wb?.util_pct ?? null,
          events: wb?.events ?? [],
          meet: target > 0 ? r.uph >= target : null,
        };
      });
      return {
        hour: h,
        label: hourLabel(h),
        future: false,
        meet: machines.filter((m) => m.meet === true).length,
        not_meet: machines.filter((m) => m.meet === false).length,
        machines,
      };
    });

    const body: UphResponse = { package: pkg, target_uph: headlineTarget, hours };
    return json(body);
  } catch (e) {
    if (e instanceof MiddlewareError) error(502, e.message);
    error(503, `API error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
