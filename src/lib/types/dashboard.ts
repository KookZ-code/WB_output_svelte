// Response shapes — mirror WB_Dashboard/src/models.rs verbatim
// Keep field names snake_case to match what the original API returned and
// what the original frontend (app.js) consumed.

export type Shift = 'D' | 'N';

export interface SummaryResponse {
  date: string;
  shift: Shift;
  shift_label: string;
  window_start: string;
  window_end: string;
  total_bonded: number;
  target_shift: number;
  achievement_pct: number;
  active_machines: number;
  active_operators: number;
}

export interface HourlyResponse {
  hours: string[];
  target_cumulative: number[];
  packages: Record<string, number[]>;
}

export interface PackageRow {
  package: string;
  plan_per_shift: number;
  bonded: number;
  target: number;
  pct: number;
}

export interface WbEvent {
  job_type: string;
  t_start: string;
  t_end: string;   // empty string = still open/active
  des_job: string;
  dur_min: number;
  is_open?: boolean; // true = currently active job from job_list
}

/** Fields returned directly from SQLite (queryMachines) */
export interface MachineRowDb {
  machine_id: string;
  badge_no: string;
  target_uph: number;
  uph: number;
  bonded_unit: number;
  vs_output_pct: number; // (bonded − target_uph × elapsed_hours) / expected × 100
}

/** Full row after merging with WB Report utilization + events */
export interface MachineRow extends MachineRowDb {
  util_pct: number | null;
  events: WbEvent[];
}

export interface MachinesResponse {
  rows: MachineRow[];
  required_mc: number; // ⌈plan_per_shift / (target_uph × shift_hours)⌉
}

export interface RawRecord {
  created_at: string;
  lot_id: string;
  package_mpc: string;
  uph: number;
  bonded_unit: number;
  delta_bonded: number;
  badge_no: string;
}

// Internal plan row (server-side only)
export interface PlanRow {
  package_raw: string;
  package_norm: string;
  plan_per_day: number;
  plan_per_shift: number;
  uph_target: number;
}
