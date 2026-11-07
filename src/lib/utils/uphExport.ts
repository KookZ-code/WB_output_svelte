import { utils, write as xlsxWrite } from 'xlsx';
import type { UphResponse, UphHour, UphMachine } from '$lib/types/dashboard';

function fmtEvents(m: UphMachine): string {
  return m.events
    .map((ev) => `${ev.job_type} ${ev.t_start}-${ev.t_end || 'open'} (${ev.dur_min}m)${ev.des_job ? ' ' + ev.des_job : ''}`)
    .join('; ');
}

function download(wb: ReturnType<typeof utils.book_new>, filename: string) {
  const wbout = xlsxWrite(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Export the UPH monitor: hourly meet/not-meet summary + machine detail for the selected hour. */
export function downloadUphExcel(data: UphResponse, date: string, shift: string, selected: UphHour | null) {
  const wb = utils.book_new();

  // Sheet 1 — hourly summary (future hours left blank)
  const hourRows: (string | number)[][] = [
    ['UPH Monitoring'],
    ['Package', data.package],
    ['Date', date],
    ['Shift', shift],
    ['Std UPH (headline)', data.target_uph > 0 ? data.target_uph : '—'],
    [],
    ['Hour', 'Meet std UPH', 'Not meet std UPH', 'Total machines'],
  ];
  for (const h of data.hours) {
    hourRows.push(
      h.future
        ? [h.label, '', '', '']
        : [h.label, h.meet, h.not_meet, h.meet + h.not_meet]
    );
  }
  const hourSheet = utils.aoa_to_sheet(hourRows as unknown[][]);
  hourSheet['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 16 }];
  utils.book_append_sheet(wb, hourSheet, 'Hourly');

  // Sheet 2 — machines of the selected hour
  if (selected && !selected.future) {
    const rows: (string | number)[][] = [
      ['Package', data.package, 'Hour', selected.label],
      [],
      ['Machine', 'Operator', 'UPH', 'Std UPH', 'vs Std %', 'Meet', 'Max UPH', 'Bonded', 'Util %', 'Last scan', 'Events in shift'],
    ];
    for (const m of selected.machines) {
      const d = m.target_uph > 0 ? ((m.uph - m.target_uph) / m.target_uph) * 100 : null;
      rows.push([
        m.machine_id,
        m.badge_no || '—',
        m.uph,
        m.target_uph > 0 ? m.target_uph : '—',
        d == null ? '—' : Number(d.toFixed(1)),
        m.meet == null ? '—' : m.meet ? 'MEET' : 'NOT MEET',
        m.max_uph ?? '—',
        m.bonded_unit,
        m.util_pct ?? '—',
        m.last_scan_ts ?? '—',
        fmtEvents(m),
      ]);
    }
    const sheet = utils.aoa_to_sheet(rows as unknown[][]);
    sheet['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
      { wch: 10 }, { wch: 10 }, { wch: 9 }, { wch: 20 }, { wch: 80 },
    ];
    utils.book_append_sheet(wb, sheet, `Machines ${selected.label.slice(0, 2)}h`);
  }

  const safePkg = data.package.replace(/[^A-Za-z0-9_-]+/g, '_');
  const hourPart = selected && !selected.future ? `_${selected.label.replace(':', '')}` : '';
  download(wb, `UPH_${safePkg}_${date}_Shift${shift}${hourPart}.xlsx`);
}
