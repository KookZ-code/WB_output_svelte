<script lang="ts">
  // Stacked bars per hour: machines meeting vs not meeting standard UPH.
  // Future hours are left empty. Click a bar to select that hour.
  import { onMount } from 'svelte';
  import {
    Chart,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    type Chart as ChartType,
  } from 'chart.js';
  import type { UphHour } from '$lib/types/dashboard';

  Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

  type Props = {
    hours: UphHour[];
    selectedHour: number | null;
    onSelectHour: (hour: number) => void;
  };
  const { hours, selectedHour, onSelectHour }: Props = $props();

  const MEET = '#6CC24A';
  const NOT_MEET = '#DA291C';
  const TEXT = '#34333E';

  let canvasEl = $state<HTMLCanvasElement>();
  let chart: ChartType<"bar", (number | null)[], string> | null = null;

  function build() {
    if (!canvasEl) return;
    chart?.destroy();
    // Clone: Chart.js mutates arrays, Svelte $state proxies would throw.
    const rows = hours.map((h) => ({ ...h }));
    const sel = selectedHour;
    const labels = rows.map((h) => h.label);
    const val = (pick: (h: UphHour) => number) => rows.map((h) => (h.future ? null : pick(h)));
    const shade = (c: string) => rows.map((h) => (sel == null || h.hour === sel ? c : c + '66'));

    chart = new Chart(canvasEl, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Meet std UPH', data: val((h) => h.meet), backgroundColor: shade(MEET), stack: 's', borderRadius: 2 },
          { label: 'Not meet std UPH', data: val((h) => h.not_meet), backgroundColor: shade(NOT_MEET), stack: 's', borderRadius: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onClick: (e, _el, c) => {
          const pts = c.getElementsAtEventForMode(e.native as Event, 'index', { intersect: false }, false);
          const i = pts[0]?.index;
          if (i != null && !rows[i].future) onSelectHour(rows[i].hour);
        },
        onHover: (e, _el, c) => {
          const t = e.native?.target as HTMLElement | undefined;
          if (!t) return;
          const pts = c.getElementsAtEventForMode(e.native as Event, 'index', { intersect: false }, false);
          t.style.cursor = pts.length && !rows[pts[0].index]?.future ? 'pointer' : 'default';
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, color: TEXT, font: { size: 11, family: "'Open Sans', sans-serif" } },
          },
          tooltip: {
            callbacks: {
              footer: (items) => {
                const h = rows[items[0]?.dataIndex ?? -1];
                return h && !h.future ? `Total: ${h.meet + h.not_meet} machines` : '';
              },
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: TEXT } },
          y: {
            stacked: true,
            beginAtZero: true,
            title: { display: true, text: 'Machines', color: TEXT },
            ticks: { precision: 0, color: TEXT },
          },
        },
      },
    });
  }

  onMount(() => () => chart?.destroy());

  $effect(() => {
    void hours;
    void selectedHour;
    build();
  });
</script>

<div class="wrap"><canvas bind:this={canvasEl}></canvas></div>

<style>
  .wrap {
    position: relative;
    height: 340px;
  }
</style>
