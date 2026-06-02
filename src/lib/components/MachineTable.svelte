<script lang="ts">
  // Drill 2 — machine table for selected (hour, package).
  import type { MachineRow } from '$lib/types/dashboard';
  import { dashboard } from '$lib/stores/dashboard.svelte';
  import { fmtInt, fmtSignedPct } from '$lib/utils/format';

  type Props = {
    rows: MachineRow[] | null;
    pkg: string | null;
    onSelect: (machineId: string) => void;
  };
  const { rows, pkg, onSelect }: Props = $props();

  function uphColor(r: MachineRow): string {
    if (r.target_uph <= 0) return 'var(--color-text-body)';
    if (r.uph >= r.target_uph) return 'var(--color-accent-green)';
    if (r.uph >= r.target_uph * 0.85) return 'var(--color-accent-orange)';
    return 'var(--color-brand-red)';
  }

  function badgeClass(pct: number): string {
    if (pct >= 0) return 'green';
    if (pct >= -20) return 'orange';
    return 'red';
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
    <table>
      <thead>
        <tr>
          <th>Machine</th>
          <th>Operator</th>
          <th class="r">Target UPH</th>
          <th class="r">Actual UPH</th>
          <th class="r">Bonded</th>
          <th class="r">Output vs Expected</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.machine_id)}
          <tr
            class:selected={r.machine_id === dashboard.selectedMachine}
            onclick={() => onSelect(r.machine_id)}
          >
            <td><strong>{r.machine_id}</strong></td>
            <td>{r.badge_no}</td>
            <td class="r muted">{r.target_uph > 0 ? fmtInt(r.target_uph) : '—'}</td>
            <td class="r" style:color={uphColor(r)} style:font-weight="700">
              {fmtInt(r.uph)}
            </td>
            <td class="r">{fmtInt(r.bonded_unit)}</td>
            <td class="r">
              <span class="badge {badgeClass(r.vs_output_pct)}">
                {fmtSignedPct(r.vs_output_pct, 0)}
              </span>
            </td>
          </tr>
        {/each}
        {#if rows.length === 0}
          <tr><td colspan="6" class="empty">No machines reporting this package in this slot</td></tr>
        {/if}
      </tbody>
    </table>
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
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--color-text-disabled);
    font-size: 13px;
    gap: 8px;
  }
  .icon {
    font-size: 30px;
  }
  .active {
    border: 1px solid var(--color-primary);
  }
  .label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-primary);
    margin-bottom: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    background: var(--color-surface-gray);
    color: var(--color-text-muted);
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.04em;
    font-weight: 700;
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
  }
  td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-surface-gray);
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: var(--color-surface-alt);
  }
  tbody tr.selected {
    background: #e8f8f5;
  }
  .r {
    text-align: right;
    font-feature-settings: 'tnum';
  }
  .muted {
    color: var(--color-text-muted);
  }
  .empty {
    text-align: center;
    color: var(--color-text-disabled);
    padding: 24px;
  }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 700;
  }
  .badge.green {
    background: #e8f5ee;
    color: var(--color-accent-green);
  }
  .badge.orange {
    background: #fef4e8;
    color: var(--color-accent-orange);
  }
  .badge.red {
    background: #fdecea;
    color: var(--color-brand-red);
  }
</style>
