// Server-only: WireBond-stage WIP per package, from the assembly A01 API
// (POST {WIP_API_URL} = .../assyapi/api/A01/pkgDOI). A01 package names differ from
// the dashboard's, so we match two ways:
//   1. MPC code in parens — QFN/VQFN variants carry the same code on both sides
//      ("20VQFN(2LX)" ↔ "20L VQFN 3x3(2LX)W" → 2LX).
//   2. Normalised name — for base packages with no MPC code
//      ("8SOIC IDF" ↔ "8L SOIC  IDF" → 8SOICIDF).
// Cached briefly — WIP changes slowly and the endpoint is shared across reloads.

import { env } from '$env/dynamic/private';

interface PkgDOIRow {
  Package: string;
  Plan: number;
  WireBond: number;
  WireBondDOI: number;
}

export interface WipVal {
  wb: number;   // WireBond-stage WIP
  doi: number;  // WireBond-stage Days Of Inventory
  plan: number; // A01 plan (per DAY — divide by 2 for per-shift)
}

export interface WipData {
  byMpc: Map<string, WipVal>;       // MPC code → WireBond WIP/DOI
  byNorm: Map<string, WipVal>;      // normalised package name → WireBond WIP/DOI
  orderByMpc: Map<string, number>;  // MPC code → A01 list position
  orderByNorm: Map<string, number>; // normalised name → A01 list position
}

const TTL_MS = 60_000;
let cache: { at: number; data: WipData } | null = null;

/** Normalise a package name to a comparable key (base packages, no MPC code).
 *  Drops "(CODE)", the "{n}L" lead-count marker, the SOT-23 suffix, and all
 *  non-alphanumerics. e.g. "8L SOIC  IDF" & "8SOIC IDF" → "8SOICIDF". */
export function normPkg(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/\(.*?\)/g, '')       // drop MPC variant "(UDX)"
    .replace(/SOT-?23/g, 'SOT')    // SOT-23 family ↔ A01 "SOT"
    .replace(/\b(\d+)L\b/g, '$1')  // "8L" lead-count marker → "8"
    .replace(/[^A-Z0-9]/g, '');    // drop spaces/dashes/etc.
}

/** Extract the MPC code from a "(CODE)" suffix, e.g. "20VQFN(2LX)" → "2LX". */
export function mpcCode(s: string): string | null {
  const m = (s || '').match(/\(([A-Za-z0-9]+)\)/);
  return m ? m[1].toUpperCase() : null;
}

/** Manual aliases for packages whose A01 name doesn't normalise to the dashboard's.
 *  Keyed by normPkg(dashboard) → normPkg(A01). */
const ALIASES: Record<string, string> = {
  '8SOIJ': '8EIAJ',          // dashboard "8SOIJ" = A01 "8L EIAJ"
  '20SSOPUD': '20SSOPUDLF',  // dashboard "20SSOP UD" = A01 "20L SSOP UDLF"
};

/** WIP/DOI for a dashboard package: prefer MPC-code match, fall back to name. */
function lookupVal(pkg: string, data: WipData): WipVal | undefined {
  const code = mpcCode(pkg);
  if (code && data.byMpc.has(code)) return data.byMpc.get(code);
  const nk = normPkg(pkg);
  return data.byNorm.get(ALIASES[nk] ?? nk);
}

export function lookupWip(pkg: string, data: WipData): number | undefined {
  return lookupVal(pkg, data)?.wb;
}

export function lookupDoi(pkg: string, data: WipData): number | undefined {
  return lookupVal(pkg, data)?.doi;
}

/** A01 plan (per DAY) for a dashboard package. Caller divides by shifts/day. */
export function lookupPlan(pkg: string, data: WipData): number | undefined {
  return lookupVal(pkg, data)?.plan;
}

/** A01 list position for a dashboard package (for ordering); undefined if absent. */
export function lookupOrder(pkg: string, data: WipData): number | undefined {
  const code = mpcCode(pkg);
  if (code && data.orderByMpc.has(code)) return data.orderByMpc.get(code);
  const nk = normPkg(pkg);
  return data.orderByNorm.get(ALIASES[nk] ?? nk);
}

function getUrl(): string {
  return env.WIP_API_URL ?? 'http://mth-vm-asoprd/assyapi/api/A01/pkgDOI';
}

/** Fetch + index WireBond WIP/DOI/Plan. On error, serve the last good cache if any
 *  (the A01 endpoint is flaky); otherwise throw so the caller can degrade. */
export async function fetchWip(): Promise<WipData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  let body: { data?: PkgDOIRow[] } | PkgDOIRow[];
  try {
    const res = await fetch(getUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`WIP API ${res.status}`);
    body = (await res.json()) as { data?: PkgDOIRow[] } | PkgDOIRow[];
  } catch (err) {
    if (cache) return cache.data; // serve stale rather than blank the columns
    throw err;
  }

  const rows = Array.isArray(body) ? body : (body.data ?? []);

  const byMpc = new Map<string, WipVal>();
  const byNorm = new Map<string, WipVal>();
  const orderByMpc = new Map<string, number>();
  const orderByNorm = new Map<string, number>();
  // Sum WIP across rows that map alike; keep the first row's DOI/Plan (not additive).
  const add = (m: Map<string, WipVal>, k: string, wb: number, doi: number, plan: number) => {
    const cur = m.get(k);
    m.set(k, { wb: (cur?.wb ?? 0) + wb, doi: cur ? cur.doi : doi, plan: cur ? cur.plan : plan });
  };
  rows.forEach((r, i) => {
    const wb = r.WireBond ?? 0;
    const doi = r.WireBondDOI ?? 0;
    const plan = r.Plan ?? 0;
    const code = mpcCode(r.Package);
    if (code) {
      add(byMpc, code, wb, doi, plan);
      if (!orderByMpc.has(code)) orderByMpc.set(code, i); // first occurrence = position
    }
    const nk = normPkg(r.Package);
    if (nk) {
      add(byNorm, nk, wb, doi, plan);
      if (!orderByNorm.has(nk)) orderByNorm.set(nk, i);
    }
  });
  const data: WipData = { byMpc, byNorm, orderByMpc, orderByNorm };
  cache = { at: Date.now(), data };
  return data;
}
