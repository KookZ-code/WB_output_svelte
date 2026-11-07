<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import UphChart from '$lib/components/UphChart.svelte';
  import { fmtInt, fmtSignedPct } from '$lib/utils/format';
  import { pillStyle, pillAbbr } from '$lib/utils/machineStatus';
  import { downloadUphExcel } from '$lib/utils/uphExport';
  import type { PackageRow, UphResponse, UphMachine, Shift } from '$lib/types/dashboard';

  const REFRESH_MS = 2 * 60 * 1000;

  function fmtDate(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function currentShift(): { date: string; shift: Shift } {
    const now = new Date();
    const h = now.getHours();
    if (h >= 19) {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      return { date: fmtDate(t), shift: 'N' };
    }
    return { date: fmtDate(now), shift: h >= 7 ? 'D' : 'N' };
  }

  const init = currentShift();
  const qp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const qDate = qp?.get('date') ?? '';
  const qShift = qp?.get('shift');
  let date = $state(/^\d{4}-\d{2}-\d{2}$/.test(qDate) ? qDate : init.date);
  let shift = $state<Shift>(qShift === 'D' || qShift === 'N' ? qShift : init.shift);
  let packages = $state<string[]>([]);
  let pkg = $state('');
  let data = $state<UphResponse | null>(null);
  let selectedHour = $state<number | null>(null);
  let onlyNotMeet = $state(false);
  let loading = $state(false);
  let errMsg = $state('');
  let lastFetch = $state('');

  async function loadPackages() {
    try {
      const res = await fetch(`${base}/api/packages?date=${date}&shift=${shift}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as PackageRow[];
      packages = rows.map((r) => r.package);
      if (pkg && !packages.includes(pkg)) {
        pkg = '';
        data = null;
      }
    } catch (e) {
      errMsg = `Failed to load packages: ${e instanceof Error ? e.message : e}`;
    }
  }

  async function loadUph(keepHour = false) {
    if (!pkg) return;
    loading = true;
    errMsg = '';
    try {
      const res = await fetch(`${base}/api/uph?date=${date}&shift=${shift}&package=${encodeURIComponent(pkg)}`);
      if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
      data = (await res.json()) as UphResponse;
      const started = data.hours.filter((h) => !h.future);
      const stillValid = keepHour && started.some((h) => h.hour === selectedHour);
      if (!stillValid) selectedHour = started.length ? started[started.length - 1].hour : null;
      lastFetch = new Date().toLocaleTimeString();
    } catch (e) {
      errMsg = `Failed to load UPH: ${e instanceof Error ? e.message : e}`;
      data = null;
    } finally {
      loading = false;
    }
  }

  async function onFilterChange() {
    selectedHour = null;
    await loadPackages();
    if (pkg) await loadUph();
  }

  onMount(() => {
    loadPackages();
    const t = setInterval(() => loadUph(true), REFRESH_MS);
    return () => clearInterval(t);
  });

  const hourData = $derived(data?.hours.find((h) => h.hour === selectedHour) ?? null);

  function exportExcel() {
    if (!data) return;
    downloadUphExcel(data, date, shift, hourData);
  }

  const rows = $derived.by(() => {
    const list = hourData?.machines ?? [];
    const filtered = onlyNotMeet ? list.filter((m) => m.meet === false) : list;
    // Worst performers first (lowest UPH vs std), machines without std last.
    return [...filtered].sort((a, b) => ratio(a) - ratio(b));
  });

  function ratio(m: UphMachine): number {
    return m.target_uph > 0 ? m.uph / m.target_uph : Infinity;
  }
  function diffPct(m: UphMachine): number | null {
    return m.target_uph > 0 ? ((m.uph - m.target_uph) / m.target_uph) * 100 : null;
  }
  function fmtTs(ts: string | null) {
    return ts ? ts.slice(11, 16) : '—';
  }
</script>

<svelte:head><title>UPH Monitoring</title></svelte:head>

<div class="page">
  <header class="header">
    <div>
      <h1>UPH Monitoring</h1>
      <div class="subtitle">Machines meeting vs. not meeting standard UPH, by hour</div>
    </div>
    <div class="filters">
      <label>Date
        <input type="date" bind:value={date} onchange={onFilterChange} />
      </label>
      <label>Shift
        <select bind:value={shift} onchange={onFilterChange}>
          <option value="D">Day (D)</option>
          <option value="N">Night (N)</option>
        </select>
      </label>
      <label>Package
        <select bind:value={pkg} onchange={() => { selectedHour = null; loadUph(); }}>
          <option value="" disabled>Select package…</option>
          {#each packages as p (p)}<option value={p}>{p}</option>{/each}
        </select>
      </label>
      <button class="btn" onclick={() => loadUph(true)} disabled={!pkg || loading}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>
      <button class="btn btn-alt" onclick={exportExcel} disabled={!data || loading}>
        Export Excel
      </button>
    </div>
  </header>

  <main class="content">
    {#if errMsg}<div class="error"><strong>Error:</strong> {errMsg}</div>{/if}

    {#if !pkg}
      <div class="empty">Select a package to view UPH monitoring.</div>
    {:else if data}
      <section class="card">
        <div class="card-head">
          <h2>{data.package} <span class="muted">· Std UPH {data.target_uph > 0 ? fmtInt(data.target_uph) : '—'}</span></h2>
          <span class="muted">{lastFetch ? `Updated ${lastFetch}` : ''} · click a bar to select hour</span>
        </div>
        <UphChart hours={data.hours} {selectedHour} onSelectHour={(h) => (selectedHour = h)} />
      </section>

      <section class="card">
        <div class="card-head">
          <h2>
            Machines{hourData ? ` · ${hourData.label}` : ''}
            {#if hourData}
              <span class="muted">· <span class="ok">{hourData.meet} meet</span> / <span class="bad">{hourData.not_meet} not meet</span></span>
            {/if}
          </h2>
          <div class="toggle" role="group" aria-label="Machine filter">
            <button class:active={!onlyNotMeet} onclick={() => (onlyNotMeet = false)}>All machines</button>
            <button class:active={onlyNotMeet} onclick={() => (onlyNotMeet = true)}>Not meet only</button>
          </div>
        </div>

        {#if !hourData}
          <div class="empty">No hour selected.</div>
        {:else if rows.length === 0}
          <div class="empty">{onlyNotMeet ? 'All machines meet standard UPH 🎉' : 'No machines for this hour.'}</div>
        {:else}
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Machine</th><th>Operator</th>
                  <th class="num">UPH</th><th class="num">Std UPH</th><th class="num">vs Std</th>
                  <th class="num">Max UPH</th><th class="num">Bonded</th><th class="num">Util %</th>
                  <th>Last scan</th><th>Events</th>
                </tr>
              </thead>
              <tbody>
                {#each rows as m (m.machine_id)}
                  {@const d = diffPct(m)}
                  <tr class:fail={m.meet === false}>
                    <td><strong>{m.machine_id}</strong></td>
                    <td>{m.badge_no || '—'}</td>
                    <td class="num" class:bad={m.meet === false} class:ok={m.meet === true}>{fmtInt(m.uph)}</td>
                    <td class="num">{m.target_uph > 0 ? fmtInt(m.target_uph) : '—'}</td>
                    <td class="num" class:bad={m.meet === false} class:ok={m.meet === true}>{d == null ? '—' : fmtSignedPct(d)}</td>
                    <td class="num">{m.max_uph != null ? fmtInt(m.max_uph) : '—'}</td>
                    <td class="num">{fmtInt(m.bonded_unit)}</td>
                    <td class="num">{m.util_pct != null ? m.util_pct.toFixed(1) + '%' : '—'}</td>
                    <td>{fmtTs(m.last_scan_ts)}</td>
                    <td class="td-events">
                      <div class="ev-wrap">
                        {#each m.events as ev, i (i)}
                          {@const c = pillStyle(ev)}
                          {@const desc = ev.des_job ? ' · ' + (ev.des_job.length > 18 ? ev.des_job.slice(0, 18) + '…' : ev.des_job) : ''}
                          <span class="ev-pill" style:background={c.bg} style:color={c.tx}
                            title="{ev.job_type}{ev.des_job ? ' · ' + ev.des_job : ''} · {ev.t_start}–{ev.t_end || 'open'} ({ev.dur_min}m)">
                            <span class="pill-abbr">{pillAbbr(ev)}</span>
                            <span class="pill-time">{ev.t_start}–{ev.t_end || 'now'}</span>{desc}
                            <span class="pill-dur">({ev.dur_min}m)</span>
                          </span>
                        {:else}
                          <span class="muted">—</span>
                        {/each}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    {:else if loading}
      <div class="empty">Loading…</div>
    {/if}
  </main>
</div>

<style>
  .page { min-height: 100vh; }
  .header {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap;
    padding: 16px var(--gutter); background: var(--color-surface); border-bottom: 1px solid var(--color-border);
  }
  h1 { font-size: 22px; }
  .subtitle { color: var(--color-text-muted); font-size: 13px; }
  .filters { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
  label { display: flex; flex-direction: column; font-size: 12px; color: var(--color-text-small); gap: 2px; }
  input, select {
    font: inherit; font-size: 14px; padding: 6px 8px; border: 1px solid var(--color-border-input);
    border-radius: var(--radius-sm); background: var(--color-surface-input); min-width: 130px;
  }
  .btn {
    padding: 7px 16px; border: 0; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600;
    background: var(--color-primary); color: #fff;
  }
  .btn:hover:not(:disabled) { background: var(--color-primary-hover); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-alt { background: var(--color-accent-green); }
  .btn-alt:hover:not(:disabled) { background: #4f9e36; }
  .content { max-width: var(--content-max); margin: 0 auto; padding: var(--gutter); display: grid; gap: 16px; }
  .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--card-pad); }
  .card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  h2 { font-size: 16px; }
  .muted { color: var(--color-text-muted); font-weight: 400; font-size: 13px; }
  .ok { color: #3f8a22; font-weight: 600; }
  .bad { color: var(--color-brand-red); font-weight: 600; }
  .empty { padding: 32px; text-align: center; color: var(--color-text-muted); }
  .error { padding: 10px 14px; background: #fdecea; color: var(--color-brand-red); border-radius: var(--radius-md); }
  .toggle { display: inline-flex; border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); overflow: hidden; }
  .toggle button { padding: 6px 14px; border: 0; background: var(--color-surface); cursor: pointer; font-size: 13px; }
  .toggle button.active { background: var(--color-primary); color: #fff; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
  th { background: var(--color-surface-alt); font-size: 12px; color: var(--color-text-small); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.fail { background: #fff6f5; }
  .td-events { white-space: normal; min-width: 280px; }
  .ev-wrap { display: flex; flex-wrap: wrap; gap: 3px; }
  .ev-pill {
    display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 4px;
    font-size: 10px; font-weight: 600; white-space: nowrap; line-height: 1.4;
  }
  .pill-abbr { font-weight: 700; }
  .pill-time { opacity: 0.85; font-size: 9px; font-weight: 500; }
  .pill-dur { opacity: 0.7; font-size: 9px; font-weight: 500; }
</style>
