<script lang="ts">
  // Drill 3 — raw scan records for the selected machine.
  import type { RawRecord } from '$lib/types/dashboard';
  import { fmtInt } from '$lib/utils/format';

  type Props = { rows: RawRecord[] | null; machineId: string | null };
  const { rows, machineId }: Props = $props();

  function deltaCls(d: number): string {
    if (d > 0) return 'pos';
    if (d < 0) return 'neg';
    return 'zero';
  }
  function deltaStr(d: number): string {
    if (d > 0) return '+' + fmtInt(d);
    if (d === 0) return '—';
    return fmtInt(d);
  }
</script>

{#if rows == null || machineId == null}
  <div class="placeholder">
    <div class="icon">↓</div>
    <span>Click a machine row to see raw scan records</span>
  </div>
{:else}
  <div class="active">
    <div class="label">▼ {machineId} — Raw Scan Records ({rows.length})</div>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Lot ID</th>
          <th>Package</th>
          <th class="r">UPH</th>
          <th class="r">Bonded (cum.)</th>
          <th class="r">Delta</th>
          <th>Operator</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r, i (r.created_at + i)}
          <tr>
            <td>{r.created_at.slice(11, 16)}</td>
            <td>{r.lot_id}</td>
            <td>{r.package_mpc}</td>
            <td class="r">{fmtInt(r.uph)}</td>
            <td class="r">{fmtInt(r.bonded_unit)}</td>
            <td class="r"><span class={deltaCls(r.delta_bonded)}>{deltaStr(r.delta_bonded)}</span></td>
            <td>{r.badge_no}</td>
          </tr>
        {/each}
        {#if rows.length === 0}
          <tr><td colspan="7" class="empty">No records in this shift window</td></tr>
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
    min-height: 200px;
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
    border: 1px solid var(--color-accent-blue);
  }
  .label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-accent-blue);
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
  tbody tr:hover {
    background: var(--color-surface-alt);
  }
  .r {
    text-align: right;
    font-feature-settings: 'tnum';
  }
  .pos {
    color: var(--color-accent-green);
    font-weight: 700;
  }
  .neg {
    color: var(--color-brand-red);
    font-weight: 700;
  }
  .zero {
    color: var(--color-text-disabled);
  }
  .empty {
    text-align: center;
    color: var(--color-text-disabled);
    padding: 24px;
  }
</style>
