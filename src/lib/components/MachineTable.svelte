<script lang="ts">
  // Drill 2 — machine table for selected (hour, package).
  import type { MachineRow, WbEvent } from '$lib/types/dashboard';
  import { dashboard } from '$lib/stores/dashboard.svelte';
  import { fmtInt, fmtSignedPct } from '$lib/utils/format';

  type Props = {
    rows: MachineRow[] | null;
    pkg: string | null;
    requiredMc: number;
    targetBonded: number;
    onSelect: (machineId: string) => void;
  };
  const { rows, pkg, requiredMc, targetBonded, onSelect }: Props = $props();

  // Expected output per machine = pro-rated target ÷ number of reporting machines
  const expectedPerMachine = $derived(
    targetBonded > 0 && (rows?.length ?? 0) > 0
      ? Math.trunc(targetBonded / (rows?.length ?? 1))
      : 0
  );

  const reportingMc = $derived(rows?.length ?? 0);
  const mcDelta     = $derived(reportingMc - requiredMc);
  const mcTone      = $derived(
    requiredMc === 0 ? 'neutral' : mcDelta >= 0 ? 'green' : 'red'
  );

  const hasUtil = $derived(rows?.some(r => r.util_pct !== null) ?? false);

  // Status KPI counts
  const statusCounts = $derived.by(() => {
    if (!rows || !hasUtil) return null;
    const counts: Record<StatusId, number> = { run:0, down:0, setup:0, convert:0, sbo:0, pm:0 };
    for (const r of rows) counts[currentStatus(r.events).id]++;
    return counts;
  });

  const STATUS_KPI_ORDER: StatusId[] = ['run','down','setup','convert','sbo','pm'];

  function uphColor(r: MachineRow): string {
    if (r.target_uph <= 0) return 'var(--color-text-body)';
    if (r.uph >= r.target_uph)        return 'var(--color-accent-green)';
    if (r.uph >= r.target_uph * 0.85) return 'var(--color-accent-orange)';
    return 'var(--color-brand-red)';
  }

  function badgeClass(pct: number): string {
    if (pct >= 0)   return 'green';
    if (pct >= -20) return 'orange';
    return 'red';
  }

  function utilColor(pct: number): string {
    if (pct >= 90) return '#5EBF33';
    if (pct >= 85) return '#FD7F20';
    return '#CC0000';
  }

  // ── Machine status from events ─────────────────────────────────────────
  type StatusId = 'run' | 'down' | 'setup' | 'convert' | 'sbo' | 'pm';
  interface MachineStatus { id: StatusId; label: string; bg: string; tx: string; }

  const STATUS_MAP: Record<string, MachineStatus> = {
    run:     { id:'run',     label:'RUN',     bg:'#5EBF33', tx:'#fff' },
    down:    { id:'down',    label:'DOWN',    bg:'#CC0000', tx:'#fff' },
    setup:   { id:'setup',   label:'SETUP',   bg:'#1D9CE4', tx:'#fff' },
    convert: { id:'convert', label:'CONV',    bg:'#009688', tx:'#fff' },
    sbo:     { id:'sbo',     label:'SBO',     bg:'#17A2B8', tx:'#fff' },
    pm:      { id:'pm',      label:'PM',      bg:'#702076', tx:'#fff' },
  };

  // Compare "HH:MM" strings — returns true if a < b
  function timeLt(a: string, b: string): boolean {
    return a.localeCompare(b) < 0;
  }

  function currentStatus(events: WbEvent[]): MachineStatus {
    if (!events.length) return STATUS_MAP.run;

    // Priority 1: explicitly open/active job (is_open flag from job_list)
    const openJob = events.find(e => e.is_open);
    if (openJob) {
      const jt = (openJob.job_type || '').toUpperCase();
      if (jt === 'M/C DOWN' || jt === 'ENGINEERING DOWN' || jt === 'FACILITY DOWN') return STATUS_MAP.down;
      if (jt === 'SETUP BY OPERATOR') return STATUS_MAP.sbo;
      if (jt === 'SETUP' || jt === 'CLEAN MOLD' || jt === 'CHANGE CAP') return STATUS_MAP.setup;
      if (jt === 'CONVERT') return STATUS_MAP.convert;
      if (jt === 'PM') return STATUS_MAP.pm;
      return STATUS_MAP.run;
    }

    // Priority 2: time-based check on closed events
    const now = new Date();
    const nowStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    let active: WbEvent | null = null;
    for (const ev of events) {
      if (!ev.t_start || !ev.t_end) continue;
      if (!timeLt(nowStr, ev.t_start) && timeLt(nowStr, ev.t_end)) {
        active = ev;
      }
    }
    if (!active) {
      // Take most recent event; if it ended before now → running
      const sorted = [...events].filter(e => e.t_end).sort((a,b) => (b.t_start||'').localeCompare(a.t_start||''));
      const last = sorted[0] ?? null;
      if (!last || (last.t_end && !timeLt(nowStr, last.t_end))) return STATUS_MAP.run;
      active = last;
    }
    if (!active) return STATUS_MAP.run;

    const jt = (active.job_type || '').toUpperCase();
    if (jt === 'M/C DOWN' || jt === 'ENGINEERING DOWN' || jt === 'FACILITY DOWN') return STATUS_MAP.down;
    if (jt === 'SETUP BY OPERATOR') return STATUS_MAP.sbo;
    if (jt === 'SETUP' || jt === 'CLEAN MOLD' || jt === 'CHANGE CAP') return STATUS_MAP.setup;
    if (jt === 'CONVERT') return STATUS_MAP.convert;
    if (jt === 'PM') return STATUS_MAP.pm;
    return STATUS_MAP.run;
  }

  // ── Job type pill config ───────────────────────────────────────────────
  const JOB_ABBR: Record<string, string> = {
    'M/C DOWN': 'DOWN', 'ENGINEERING DOWN': 'ENG↓', 'FACILITY DOWN': 'FAC↓',
    'PM': 'PM', 'SETUP': 'SETUP', 'SETUP BY OPERATOR': 'SBO',
    'CONVERT': 'CONV', 'CLEAN MOLD': 'CLEAN', 'CHANGE CAP': 'CHG',
  };
  const JOB_COLOR: Record<string, { bg: string; tx: string }> = {
    'M/C DOWN':          { bg: '#CC0000', tx: '#fff' },
    'ENGINEERING DOWN':  { bg: '#990000', tx: '#fff' },
    'FACILITY DOWN':     { bg: '#FD7F20', tx: '#fff' },
    'PM':                { bg: '#702076', tx: '#fff' },
    'SETUP':             { bg: '#1D9CE4', tx: '#fff' },
    'SETUP BY OPERATOR': { bg: '#17A2B8', tx: '#fff' },
    'CONVERT':           { bg: '#009688', tx: '#fff' },
    'CLEAN MOLD':        { bg: '#5EBF33', tx: '#fff' },
    'CHANGE CAP':        { bg: '#8A8A8A', tx: '#fff' },
  };

  function pillStyle(ev: WbEvent): { bg: string; tx: string } {
    return JOB_COLOR[(ev.job_type || '').toUpperCase()] ?? { bg: '#8A8A8A', tx: '#fff' };
  }
  function pillAbbr(ev: WbEvent): string {
    return JOB_ABBR[(ev.job_type || '').toUpperCase()] ?? (ev.job_type || '').slice(0, 5);
  }
</script>

{#if rows == null || pkg == null}
  <div class="placeholder">
    <div class="icon">←</div>
    <span>Click a package to see machine breakdown</span>
  </div>
{:else}
  <div class="active">
    <div class="label">▼ {pkg} — by Machine</div>

    <!-- Header row: status KPIs + M/C counts in one line -->
    <div class="header-row">
      <!-- Status KPI chips -->
      {#if statusCounts}
        <div class="status-chips">
          {#each STATUS_KPI_ORDER as sid (sid)}
            {@const st = STATUS_MAP[sid]}
            {@const cnt = statusCounts[sid]}
            {#if cnt > 0 || sid === 'run'}
              <div class="sk-chip" style="--sb:{st.bg}" title="{st.label}">
                <span class="sk-num">{cnt}</span>
                <span class="sk-label" style:color={st.bg}>{st.label}</span>
              </div>
            {/if}
          {/each}
        </div>
      {/if}

      <!-- Divider -->
      {#if statusCounts}<div class="hdr-sep"></div>{/if}

      <!-- Reporting / required -->
      <div class="mc-stat">
        <span class="mc-val">{reportingMc}</span>
        <span class="mc-sub">reporting</span>
      </div>
      <span class="mc-slash">/</span>
      <div class="mc-stat">
        <span class="mc-val">{requiredMc > 0 ? requiredMc : '—'}</span>
        <span class="mc-sub">required</span>
      </div>
      {#if requiredMc > 0}
        <div class="mc-delta {mcTone}">
          {mcDelta >= 0 ? '+' : ''}{mcDelta} M/C
        </div>
      {/if}
    </div>

    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Machine</th>
            <th class="r">Expected</th>
            <th class="r">Bonded</th>
            <th class="r">Output vs Expected</th>
            {#if hasUtil}
              <th>Status</th>
              <th class="r">Utilization</th>
              <th>Events in Shift</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.machine_id)}
            <tr
              class:selected={r.machine_id === dashboard.selectedMachine}
              class:row-low={r.util_pct !== null && r.util_pct < 85}
              onclick={() => onSelect(r.machine_id)}
            >
              <td><strong>{r.machine_id}</strong></td>
              <td class="r muted">{expectedPerMachine > 0 ? fmtInt(expectedPerMachine) : '—'}</td>
              <td class="r">{fmtInt(r.bonded_unit)}</td>
              <td class="r">
                <span class="badge {badgeClass(r.vs_output_pct)}">
                  {fmtSignedPct(r.vs_output_pct, 0)}
                </span>
              </td>

              {#if hasUtil}
                <!-- Status indicator -->
                {#if true}
                  {@const st = currentStatus(r.events)}
                  <td class="td-status">
                    <span class="status-badge"
                      style:background={st.bg}
                      style:color={st.tx}>{st.label}</span>
                  </td>
                {/if}

                <!-- Utilization — value only, no bar -->
                <td class="r td-util">
                  {#if r.util_pct !== null}
                    {@const uc = utilColor(r.util_pct)}
                    <span style:color={uc} style:font-weight="700"
                          style:font-size="12px">{r.util_pct.toFixed(1)}%</span>
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>

                <!-- Events in Shift -->
                <td class="td-events">
                  <div class="ev-wrap">
                    {#each r.events as ev (ev.t_start + ev.job_type)}
                      {@const c  = pillStyle(ev)}
                      {@const ab = pillAbbr(ev)}
                      {@const desc = ev.des_job ? ' · ' + (ev.des_job.length > 18 ? ev.des_job.slice(0,18)+'…' : ev.des_job) : ''}
                      <span class="ev-pill"
                        style:background={c.bg}
                        style:color={c.tx}
                        title="{ev.job_type}{ev.des_job ? ' · '+ev.des_job : ''} · {ev.t_start}–{ev.t_end} ({ev.dur_min}m)">
                        <span class="pill-abbr">{ab}</span>
                        <span class="pill-time">{ev.t_start}–{ev.t_end}</span>{desc}
                        <span class="pill-dur">({ev.dur_min}m)</span>
                      </span>
                    {:else}
                      <span class="muted">—</span>
                    {/each}
                  </div>
                </td>
              {/if}
            </tr>
          {/each}
          {#if rows.length === 0}
            <tr>
              <td colspan={hasUtil ? 9 : 6} class="empty">
                No machines reporting this package in this slot
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
{/if}

<style>
  .placeholder,
  .active {
    background: var(--color-surface);
    border-radius: var(--radius-sm);
    min-height: 220px;
    padding: 16px 20px;
  }
  .placeholder {
    border: 2px dashed var(--color-border);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    color: var(--color-text-disabled);
    font-size: 13px; gap: 8px;
  }
  .icon { font-size: 30px; }
  .active { border: 1px solid var(--color-primary); }
  .label {
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--color-primary); margin-bottom: 8px;
  }

  /* ── Header row (status chips + M/C counts on one line) ─────────── */
  .header-row {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    margin-bottom: 10px;
    padding: 6px 12px;
    background: var(--color-surface-gray);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
  }

  /* Status chips */
  .status-chips { display: flex; gap: 4px; align-items: center; }
  .sk-chip {
    display: flex; align-items: baseline; gap: 5px;
    padding: 3px 10px;
    background: var(--color-surface);
    border-left: 3px solid var(--sb);
    border-radius: var(--radius-sm);
    box-shadow: 0 1px 2px rgba(0,0,0,.06);
  }
  .sk-num {
    font-size: 15px; font-weight: 800;
    font-feature-settings: 'tnum'; line-height: 1;
    color: var(--color-text-body);
  }
  .sk-label {
    font-size: 9px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .6px;
  }

  /* Separator */
  .hdr-sep {
    width: 1px; height: 20px;
    background: var(--color-border);
    margin: 0 4px; flex-shrink: 0;
  }

  /* M/C reporting / required */
  .mc-stat  { display: flex; align-items: baseline; gap: 3px; }
  .mc-val   { font-size: 14px; font-weight: 700; font-feature-settings: 'tnum'; color: var(--color-text-body); }
  .mc-sub   { font-size: 9px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
  .mc-slash { font-size: 12px; color: var(--color-text-muted); margin: 0 1px; }
  .mc-delta {
    padding: 2px 8px; border-radius: var(--radius-sm);
    font-size: 11px; font-weight: 700; margin-left: 2px;
  }
  .mc-delta.green   { background: #e8f5ee; color: var(--color-accent-green); }
  .mc-delta.red     { background: #fdecea; color: var(--color-brand-red); }
  .mc-delta.neutral { background: var(--color-surface); color: var(--color-text-muted); }

  /* Table */
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th {
    background: var(--color-surface-gray); color: var(--color-text-muted);
    text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em;
    font-weight: 700; padding: 8px 10px; text-align: left;
    border-bottom: 1px solid var(--color-border); white-space: nowrap;
  }
  td { padding: 7px 10px; border-bottom: 1px solid var(--color-surface-gray); vertical-align: middle; }
  tbody tr { cursor: pointer; }
  tbody tr:hover  { background: var(--color-surface-alt); }
  tbody tr.selected { background: #e8f8f5; }
  tbody tr.row-low  { background: #fff0f0; }
  tbody tr.row-low:hover { background: #ffe0e0; }
  .r { text-align: right; font-feature-settings: 'tnum'; }
  .muted { color: var(--color-text-muted); }
  .empty { text-align: center; color: var(--color-text-disabled); padding: 24px; }

  /* Output badge */
  .badge { display: inline-block; padding: 2px 8px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 700; }
  .badge.green  { background: #e8f5ee; color: var(--color-accent-green); }
  .badge.orange { background: #fef4e8; color: var(--color-accent-orange); }
  .badge.red    { background: #fdecea; color: var(--color-brand-red); }

  /* Utilization column */
  .td-status { white-space: nowrap; }
  .status-badge {
    display: inline-block; padding: 2px 9px; border-radius: 4px;
    font-size: 10px; font-weight: 800; letter-spacing: .6px;
    text-transform: uppercase; white-space: nowrap;
  }
  .td-util { min-width: 72px; }

  /* Events column */
  .td-events { max-width: 420px; }
  .ev-wrap   { display: flex; flex-wrap: wrap; gap: 3px; }
  .ev-pill {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 6px; border-radius: 4px;
    font-size: 10px; font-weight: 600; white-space: nowrap;
    cursor: default; line-height: 1.4;
  }
  .pill-abbr { font-weight: 700; }
  .pill-time { opacity: .85; font-size: 9px; font-weight: 500; }
  .pill-dur  { opacity: .7;  font-size: 9px; font-weight: 500; }
</style>
