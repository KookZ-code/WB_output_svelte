import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan } from '$lib/server/plan-cache';
import { queryRecords } from '$lib/server/queries/records';
import { displayToDb, resolveShift } from '$lib/server/handler-utils';

export const GET: RequestHandler = async ({ url }) => {
  const { window: w } = resolveShift(url);
  const plan = getPlan();

  const machineId = url.searchParams.get('machine_id');
  const pkg = url.searchParams.get('package');
  if (!machineId) error(400, 'Missing required query param: machine_id');
  if (!pkg) error(400, 'Missing required query param: package');

  const dbPkg = displayToDb(pkg, plan.displayNames);

  try {
    const rows = queryRecords(w, machineId, dbPkg);
    return json(rows);
  } catch (e) {
    error(503, `DB error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
