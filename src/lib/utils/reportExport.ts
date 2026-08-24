import { utils, write as xlsxWrite } from 'xlsx';
import type { ReportData } from '$lib/types/dashboard';

function calculateLostGroups(mins: Record<string, number>) {
  const setup = (mins['SETUP'] ?? 0) + (mins['SBO'] ?? 0) + (mins['IDLE'] ?? 0);
  const convert = mins['CONVERT'] ?? 0;
  const downtime = (mins['DOWN'] ?? 0) + (mins['PM'] ?? 0);
  return { setup, convert, downtime };
}

export function downloadExcel(data: ReportData) {
  const wb = utils.book_new();

  // Detail sheet
  const detailRows: (string | number)[][] = [];
  detailRows.push(['Wire Bond Output Report']);
  detailRows.push(['Date', data.date]);
  detailRows.push(['Shift', `${data.shift} (${data.shift_label})`]);
  detailRows.push(['Period', `${data.window_start} - ${data.window_end}`]);
  detailRows.push([]);
  detailRows.push(['Shift Summary']);
  detailRows.push(['Total Bonded', data.total_bonded, 'units']);
  detailRows.push(['Shift Target', data.target_shift, 'units']);
  detailRows.push(['Achievement', `${data.achievement_pct.toFixed(1)}%`]);
  detailRows.push([]);
  detailRows.push([
    'Package',
    'Machine',
    'Actual',
    'Target',
    'vs Target %',
    'Status',
    'Utilization %',
    'UPH',
    'Set up (min)',
    'Buy off / Cratering (min)',
    'Downtime (min)',
  ]);

  for (const pkg of data.packages) {
    for (const machine of pkg.machines) {
      const lost = calculateLostGroups(machine.lost_group_mins);

      detailRows.push([
        pkg.package,
        machine.machine_id,
        machine.bonded_unit,
        machine.expected_output,
        `${machine.vs_output_pct.toFixed(1)}%`,
        machine.util_pct !== null ? 'ACTIVE' : 'NO_DATA',
        machine.util_pct !== null ? `${machine.util_pct.toFixed(1)}%` : '—',
        machine.max_uph !== null ? machine.max_uph : '—',
        lost.setup > 0 ? lost.setup : '—',
        lost.convert > 0 ? lost.convert : '—',
        lost.downtime > 0 ? lost.downtime : '—',
      ]);
    }
  }

  const detailSheet = utils.aoa_to_sheet(detailRows as unknown[][]);
  detailSheet['!cols'] = [
    { wch: 20 },  // Package
    { wch: 12 },  // Machine
    { wch: 10 },  // Actual
    { wch: 10 },  // Target
    { wch: 12 },  // vs Target %
    { wch: 12 },  // Status
    { wch: 12 },  // Utilization %
    { wch: 10 },  // UPH
    { wch: 16 },  // Set up (min)
    { wch: 20 },  // Buy off / Cratering (min)
    { wch: 15 },  // Downtime (min)
  ];

  utils.book_append_sheet(wb, detailSheet, 'Report');

  // Summary sheet
  const summaryRows: (string | number)[][] = [];
  summaryRows.push(['Package Summary']);
  summaryRows.push([]);
  summaryRows.push(['Package', 'Bonded', 'Target', 'vs Target %', 'Machines']);

  for (const pkg of data.packages) {
    summaryRows.push([
      pkg.package,
      pkg.bonded,
      pkg.target,
      `${pkg.pct.toFixed(1)}%`,
      pkg.machines.length,
    ]);
  }

  const summarySheet = utils.aoa_to_sheet(summaryRows as unknown[][]);
  summarySheet['!cols'] = [
    { wch: 20 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
  ];

  utils.book_append_sheet(wb, summarySheet, 'Summary');

  const filename = `WB_Report_${data.date}_Shift${data.shift}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  // Write to blob and trigger download
  const wbout = xlsxWrite(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
