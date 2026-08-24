<script lang="ts">
  import { base } from '$app/paths';
  import type { ReportData } from '$lib/types/dashboard';
  import { downloadExcel } from '$lib/utils/reportExport';
  import { fmtInt, fmtSignedPct } from '$lib/utils/format';

  let date = $state(new Date().toISOString().split('T')[0]);
  let shift = $state<'D' | 'N'>('D');
  let reportData: ReportData | null = $state(null);
  let loading = $state(false);
  let error: string | null = $state(null);
  let expandedPackages = $state<Record<string, boolean>>({});

  async function loadReport() {
    loading = true;
    error = null;
    reportData = null;

    try {
      const response = await fetch(`${base}/api/report?date=${date}&shift=${shift}`);
      if (!response.ok) {
        throw new Error(`Failed to load report: ${response.statusText}`);
      }
      reportData = await response.json();
      expandedPackages = {};
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  function togglePackage(pkg: string) {
    expandedPackages[pkg] = !expandedPackages[pkg];
  }

  function handleExport() {
    if (!reportData) return;
    downloadExcel(reportData);
  }

  function machineStatusColor(util: number | null): string {
    if (util === null) return 'var(--color-text-muted)';
    if (util >= 90) return 'var(--color-accent-green)';
    if (util >= 85) return 'var(--color-accent-orange)';
    return 'var(--color-brand-red)';
  }

  function vsPctColor(pct: number): string {
    if (pct >= 0) return 'var(--color-accent-green)';
    if (pct >= -20) return 'var(--color-accent-orange)';
    return 'var(--color-brand-red)';
  }

  function calculateLostGroups(mins: Record<string, number>) {
    const setup = (mins['SETUP'] ?? 0) + (mins['SBO'] ?? 0) + (mins['IDLE'] ?? 0);
    const convert = mins['CONVERT'] ?? 0;
    const downtime = (mins['DOWN'] ?? 0) + (mins['PM'] ?? 0);
    return { setup, convert, downtime };
  }
</script>

<div class="container">
  <header class="report-header">
    <h1>Wire Bond Output Report</h1>
    <div class="controls">
      <label>
        Date:
        <input type="date" bind:value={date} />
      </label>
      <label>
        Shift:
        <select bind:value={shift}>
          <option value="D">Day (D)</option>
          <option value="N">Night (N)</option>
        </select>
      </label>
      <button onclick={loadReport} disabled={loading} class="btn-primary">
        {loading ? 'Loading...' : 'Generate Report'}
      </button>
      {#if reportData}
        <button onclick={handleExport} class="btn-secondary">Export to Excel</button>
      {/if}
    </div>
  </header>

  {#if error}
    <div class="error-box">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  {#if reportData}
    <div class="report-wrapper">
      <div class="report-summary">
        <div class="summary-header">
          <h2>Shift Summary</h2>
          <p class="period">
            {reportData.date} | Shift {reportData.shift} ({reportData.shift_label})
            <br />
            Period: {reportData.window_start} – {reportData.window_end}
          </p>
        </div>

        <div class="summary-grid">
          <div class="summary-card">
            <span class="label">Total Bonded</span>
            <span class="value">{fmtInt(reportData.total_bonded)}</span>
            <span class="unit">units</span>
          </div>
          <div class="summary-card">
            <span class="label">Shift Target</span>
            <span class="value">{fmtInt(reportData.target_shift)}</span>
            <span class="unit">units</span>
          </div>
          <div class="summary-card achievement">
            <span class="label">Achievement</span>
            <span class="value" style:color="var(--color-accent-green)">
              {reportData.achievement_pct.toFixed(1)}%
            </span>
            <span class="unit">of target</span>
          </div>
        </div>
      </div>

      <div class="packages-section">
        {#each reportData.packages as pkg (pkg.package)}
          {@const isExpanded = !!expandedPackages[pkg.package]}
          <div class="package-card">
            <button
              class="package-header"
              onclick={() => togglePackage(pkg.package)}
            >
              <span class="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
              <span class="package-name">{pkg.package}</span>
              <span class="package-stats">
                {fmtInt(pkg.bonded)} / {fmtInt(pkg.target)}
                <span class="pct" style:color={vsPctColor(pkg.pct)}>
                  ({fmtSignedPct(pkg.pct, 1)})
                </span>
              </span>
              <span class="machine-count">{pkg.machines.length} M/C</span>
            </button>

            {#if isExpanded}
              <div class="machine-table">
                <table>
                  <thead>
                    <tr>
                      <th>Machine</th>
                      <th class="r">Actual</th>
                      <th class="r">Target</th>
                      <th class="r">vs Target %</th>
                      <th class="r">Util %</th>
                      <th class="r">UPH</th>
                      <th class="r">Set up (min)</th>
                      <th class="r">Buy off / Cratering (min)</th>
                      <th class="r">Downtime (min)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each pkg.machines as machine (machine.machine_id)}
                      {@const lost = calculateLostGroups(machine.lost_group_mins)}
                      <tr>
                        <td><strong>{machine.machine_id}</strong></td>
                        <td class="r">{fmtInt(machine.bonded_unit)}</td>
                        <td class="r">{machine.expected_output > 0 ? fmtInt(machine.expected_output) : '—'}</td>
                        <td class="r">
                          <span class="pct" style:color={vsPctColor(machine.vs_output_pct)}>
                            {fmtSignedPct(machine.vs_output_pct, 1)}
                          </span>
                        </td>
                        <td class="r">
                          {#if machine.util_pct !== null}
                            <span style:color={machineStatusColor(machine.util_pct)}>
                              {machine.util_pct.toFixed(1)}%
                            </span>
                          {:else}
                            <span class="muted">—</span>
                          {/if}
                        </td>
                        <td class="r">
                          {#if machine.max_uph !== null}
                            {fmtInt(machine.max_uph)}
                          {:else}
                            <span class="muted">—</span>
                          {/if}
                        </td>
                        <td class="r">{lost.setup > 0 ? lost.setup : '—'}</td>
                        <td class="r">{lost.convert > 0 ? lost.convert : '—'}</td>
                        <td class="r">{lost.downtime > 0 ? lost.downtime : '—'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {:else if !loading && !error}
    <div class="placeholder">
      <p>Select date and shift, then click "Generate Report" to view</p>
    </div>
  {/if}
</div>

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
    background: var(--color-bg-page);
    min-height: 100vh;
  }

  .report-header {
    margin-bottom: 24px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 24px;
  }

  .report-header h1 {
    margin: 0 0 16px 0;
    font-size: 24px;
    font-weight: 700;
    color: var(--color-text-body);
  }

  .controls {
    display: flex;
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .controls label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .controls input,
  .controls select {
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 14px;
    background: var(--color-surface);
    color: var(--color-text-body);
    font-family: inherit;
  }

  .controls input:focus,
  .controls select:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px rgba(0, 127, 187, 0.1);
  }

  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-primary {
    background: var(--color-primary);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-dark, #005f9e);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--color-accent-green);
    color: #fff;
  }

  .btn-secondary:hover {
    background: #4da829;
  }

  .error-box {
    margin-bottom: 16px;
    padding: 12px 16px;
    background: #fdecea;
    border: 1px solid var(--color-brand-red);
    border-radius: var(--radius-sm);
    color: var(--color-brand-red);
    font-size: 14px;
  }

  .report-wrapper {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 24px;
  }

  .report-summary {
    margin-bottom: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--color-border);
  }

  .summary-header {
    margin-bottom: 16px;
  }

  .summary-header h2 {
    margin: 0 0 8px 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--color-text-body);
  }

  .period {
    margin: 0;
    font-size: 13px;
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }

  .summary-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    background: var(--color-surface-gray);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }

  .summary-card.achievement {
    background: #e8f5ee;
  }

  .summary-card .label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--color-text-muted);
    letter-spacing: 0.04em;
  }

  .summary-card .value {
    font-size: 24px;
    font-weight: 700;
    font-feature-settings: 'tnum';
    color: var(--color-text-body);
  }

  .summary-card .unit {
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .packages-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .package-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .package-header {
    width: 100%;
    padding: 12px 16px;
    background: var(--color-surface-gray);
    border: none;
    border-bottom: 1px solid var(--color-border);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-body);
    transition: background 0.2s ease;
  }

  .package-header:hover {
    background: var(--color-surface-alt);
  }

  .toggle-icon {
    font-size: 12px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .package-name {
    flex-grow: 1;
    text-align: left;
    color: var(--color-primary);
    font-weight: 700;
  }

  .package-stats {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13px;
    font-feature-settings: 'tnum';
  }

  .package-stats .pct {
    font-weight: 700;
  }

  .machine-count {
    font-size: 12px;
    color: var(--color-text-muted);
    background: var(--color-surface);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
  }

  .machine-table {
    overflow-x: auto;
    background: var(--color-surface);
  }

  .machine-table table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .machine-table th {
    background: var(--color-surface-gray);
    color: var(--color-text-muted);
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.04em;
    font-weight: 700;
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }

  .machine-table td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-surface-gray);
    text-align: left;
  }

  .machine-table tr:hover {
    background: var(--color-surface-alt);
  }

  .machine-table .r {
    text-align: right;
    font-feature-settings: 'tnum';
  }

  .machine-table .muted {
    color: var(--color-text-muted);
  }

  .machine-table .pct {
    font-weight: 700;
  }

  .placeholder {
    padding: 60px 24px;
    text-align: center;
    color: var(--color-text-muted);
    font-size: 14px;
  }
</style>
