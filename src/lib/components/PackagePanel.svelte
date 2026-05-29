<script lang="ts">
  // Drill 1 — package breakdown for the selected hour. Progress bars colored
  // by pace (green ≥ on target, orange ≥ 70% of pro-rated target, else red).
  import type { PackageRow } from '$lib/types/dashboard';
  import { dashboard } from '$lib/stores/dashboard.svelte';
  import { fmtInt } from '$lib/utils/format';

  type Props = {
    rows: PackageRow[] | null;
    hour: number | null;
    onSelect: (pkg: string) => void;
  };
  const { rows, hour, onSelect }: Props = $props();

  const maxBonded = $derived(rows && rows.length > 0 ? Math.max(...rows.map((r) => r.bonded), 1) : 1);

  function paceColor(r: PackageRow): string {
    if (r.plan_per_shift === 0) return 'var(--color-brand-red)';
    if (r.bonded >= r.target) return 'var(--color-accent-green)';
    if (r.bonded >= r.target * 0.7) return 'var(--color-accent-orange)';
    return 'var(--color-brand-red)';
  }
</script>

{#if rows == null || hour == null}
  <div class="placeholder">
    <div class="icon">↑</div>
    <span>Click a bar above to see package breakdown</span>
  </div>
{:else}
  <div class="active">
    <div class="label">▼ {hour}:00 hr — by Package</div>
    <div class="ph-row">
      <div class="ph-pkg"></div>
      <div class="ph-bar"></div>
      <div class="ph-num">Plan/Shift</div>
      <div class="ph-num">Output</div>
      <div class="ph-pct">% Plan</div>
    </div>
    <div class="list">
      {#each rows as r (r.package)}
        <button
          type="button"
          class="row"
          class:selected={r.package === dashboard.selectedPkg}
          onclick={() => onSelect(r.package)}
        >
          <div class="pkg">{r.package}</div>
          <div class="bar-wrap">
            <div
              class="bar-fill"
              style:width="{Math.min((r.bonded / maxBonded) * 100, 100)}%"
              style:background={paceColor(r)}
            ></div>
          </div>
          <div class="num">{r.plan_per_shift > 0 ? fmtInt(r.plan_per_shift) : '—'}</div>
          <div class="num strong">{fmtInt(r.bonded)}</div>
          <div class="pct" style:color={paceColor(r)}>
            {r.plan_per_shift > 0 ? r.pct.toFixed(0) + '%' : '—'}
          </div>
        </button>
      {/each}
      {#if rows.length === 0}
        <div class="empty">No production in this slot</div>
      {/if}
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
    border: 1px solid var(--color-primary-hover);
  }
  .label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-primary-hover);
    margin-bottom: 10px;
  }

  .ph-row,
  .row {
    display: grid;
    grid-template-columns: 80px 1fr 70px 70px 50px;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }
  .ph-row {
    color: var(--color-text-muted);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 4px 4px;
    border-bottom: 1px solid var(--color-border);
    font-size: 10px;
  }
  .ph-num,
  .ph-pct {
    text-align: right;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
  }
  .row {
    background: transparent;
    border: none;
    padding: 5px 4px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }
  .row:hover {
    background: var(--color-surface-alt);
  }
  .row.selected {
    background: #e8f0fa;
  }
  .pkg {
    color: var(--color-text-dark);
    font-weight: 600;
  }
  .bar-wrap {
    background: var(--color-surface-gray);
    border-radius: var(--radius-sm);
    height: 14px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: var(--radius-sm);
    transition: width 0.4s;
  }
  .num {
    text-align: right;
    color: var(--color-text-muted);
    font-feature-settings: 'tnum';
  }
  .num.strong {
    color: var(--color-text-body);
    font-weight: 700;
  }
  .pct {
    text-align: right;
    font-weight: 600;
    font-feature-settings: 'tnum';
  }
  .empty {
    text-align: center;
    color: var(--color-text-disabled);
    padding: 24px;
    font-size: 13px;
  }
</style>
