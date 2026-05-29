// Shared helpers for the +server.ts endpoints — port of the Rust handlers'
// `resolve_shift`, `parse_pkg_filter`, `display_to_db`.

import type { Shift } from '$lib/types/dashboard';
import type { ShiftWindow } from './shift';
import { shiftWindow } from './shift';

/** Server-side equivalent of `current_shift()` from shift.rs — uses local time. */
export function currentShift(): { date: string; shift: Shift } {
  const now = new Date();
  const h = now.getHours();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (h >= 7 && h < 19) return { date: fmt(now), shift: 'D' };
  if (h >= 19) {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return { date: fmt(t), shift: 'N' };
  }
  return { date: fmt(now), shift: 'N' };
}

export function resolveShift(url: URL): { date: string; shift: Shift; window: ShiftWindow } {
  const def = currentShift();
  const dateParam = url.searchParams.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : def.date;
  const shiftParam = url.searchParams.get('shift');
  const shift: Shift = shiftParam === 'N' || shiftParam === 'D' ? shiftParam : def.shift;
  return { date, shift, window: shiftWindow(date, shift) };
}

export function parsePkgFilter(url: URL): string[] {
  const v = url.searchParams.get('packages');
  if (!v) return [];
  return v
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** display_to_db: reverse the displayNames map (display_name → db_key). */
export function displayToDb(name: string, displayNames: Map<string, string>): string {
  for (const [dbKey, disp] of displayNames) {
    if (disp === name) return dbKey;
  }
  return name;
}
