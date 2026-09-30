import type { ChartTheme } from '../../ui/chart/theme';

/** HTML for an ECharts tooltip: a bold title and label/value rows with mono figures. */
export function tipHtml(theme: ChartTheme, title: string, rows: [label: string, value: string][]): string {
  const row = ([label, value]: [string, string]) =>
    `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:${theme.muted}">${label}</span><span style="font-family:${theme.fontMono}">${value}</span></div>`;
  return `<div style="font-weight:600;margin-bottom:4px">${title}</div>${rows.map(row).join('')}`;
}
