import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { queryMachines } from '$lib/server/queries/machines';
import { displayToDb, resolveShift } from '$lib/server/handler-utils';
import { env } from '$env/dynamic/private';
import type { WbEvent } from '$lib/types/dashboard';

// ── Machine ID normalisation ──────────────────────────────────────────────
// WB Report uses "W/B # 334R", Output Monitoring uses "WB334R".
// Strip everything except letters and digits, uppercase → same key.
function normId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

// ── Fetch utilisation + events from EMH WB Report middleware ─────────────
interface WbReportMachine {
  machine_id: string;
  util_pct: number;
  events: WbEvent[];
}

async function fetchWbReport(date: string, shift: 'D' | 'N'): Promise<Map<string, WbReportMachine>> {
  const base    = (env.WB_REPORT_URL ?? 'http://localhost:8001').replace(/\/$/, '');
  const apiKey  = env.WB_REPORT_API_KEY ?? 'mch_dev_12345';
  const shiftFull = shift === 'D' ? 'Day' : 'Night';

  const url = `${base}/api/v1/wb/report?date=${date}&shift=${shiftFull}&packages=__ALL__`;

  const res = await fetch(url, {
    headers: { 'X-API-Key': apiKey },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`WB Report API ${res.status}`);

  const body = await res.json() as { status: string; data?: { machines?: WbReportMachine[] } };
  if (body.status !== 'ok' || !body.data?.machines) return new Map();

  const map = new Map<string, WbReportMachine>();
  for (const m of body.data.machines) {
    map.set(normId(m.machine_id), m);
  }
  return map;
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
    // Run SQLite query and WB Report fetch in parallel
    const [rows, wbMap] = await Promise.all([
      Promise.resolve(queryMachines(w, hour, dbPkg, plan.planMap, plan.mpcPlanMap)),
      fetchWbReport(date, shift).catch(() => new Map<string, WbReportMachine>()),
    ]);

    // Merge utilisation + events into each row
    const merged = rows.map(r => {
      const wb = wbMap.get(normId(r.machine_id));
      return {
        ...r,
        util_pct: wb?.util_pct ?? null,
        events:   wb?.events   ?? [],
      };
    });

    const base = dbPkg.split('(')[0] ?? dbPkg;
    const planRow = plan.mpcPlanMap.get(dbPkg) ?? plan.planMap.get(base);
    const targetUph = planRow?.uph_target ?? 0;
    const planPerShift = planRow?.plan_per_shift ?? 0;
    const shiftHours = w.hours.length;
    const slotIdx = Math.max(0, w.hours.indexOf(hour));
    const hourFraction = (slotIdx + 1) / shiftHours;

    const required_mc =
      targetUph > 0 && planPerShift > 0
        ? Math.ceil(planPerShift / (targetUph * shiftHours))
        : 0;
    const target_bonded = Math.trunc(planPerShift * hourFraction);

    return json({ rows: merged, required_mc, target_bonded });
  } catch (e) {
    error(503, `DB error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
