import { useEffect, useState } from 'react';

/** Colours and fonts for charts, read from the CSS tokens so charts follow the theme. */
export interface ChartTheme {
  dark: boolean;
  ink: string;
  ink2: string;
  muted: string;
  rule: string;
  ruleStrong: string;
  surface: string;
  bg: string;
  accent: string;
  /** Categorical series in fixed order. Max three per chart. */
  series: [string, string, string];
  /** Sequential ramp light → dark (dark mode: dark → light, i.e. low → high contrast). */
  sequential: string[];
  good: string;
  warning: string;
  critical: string;
  fontSans: string;
  fontMono: string;
}

function read(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    dark: style.colorScheme === 'dark' || v('color-scheme') === 'dark',
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--muted'),
    rule: v('--rule'),
    ruleStrong: v('--rule-strong'),
    surface: v('--surface'),
    bg: v('--bg'),
    accent: v('--accent'),
    series: [v('--series-1'), v('--series-2'), v('--series-3')],
    sequential: [0, 1, 2, 3, 4, 5].map((i) => v(`--seq-${i}`)),
    good: v('--good'),
    warning: v('--warning'),
    critical: v('--critical'),
    fontSans: v('--font-sans'),
    fontMono: v('--font-mono'),
  };
}

const listeners = new Set<() => void>();
let current: ChartTheme | null = null;

/** Call after changing `data-theme` so charts re-read the tokens. */
export function refreshChartTheme(): void {
  current = read();
  for (const listener of listeners) listener();
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(() => (current ??= read()));
  useEffect(() => {
    const update = () => setTheme(current ?? read());
    listeners.add(update);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onMedia = () => refreshChartTheme();
    media.addEventListener('change', onMedia);
    return () => {
      listeners.delete(update);
      media.removeEventListener('change', onMedia);
    };
  }, []);
  return theme;
}

/** Shared pieces of chart options so every chart looks the same. */
export function baseOption(theme: ChartTheme) {
  return {
    animationDuration: 350,
    textStyle: { fontFamily: theme.fontSans, color: theme.ink2, fontSize: 12 },
    grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
    tooltip: tooltip(theme),
  };
}

export function tooltip(theme: ChartTheme) {
  return {
    trigger: 'axis' as const,
    backgroundColor: theme.surface,
    borderColor: theme.ruleStrong,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: theme.ink, fontFamily: theme.fontSans, fontSize: 12 },
    extraCssText: 'border-radius:3px;box-shadow:none;',
    axisPointer: { type: 'line' as const, lineStyle: { color: theme.ruleStrong, width: 1 }, shadowStyle: { color: theme.rule, opacity: 0.35 } },
  };
}

/** Formats axis numbers in the page language (1.000 vs 1,000). */
export function localNumber(value: number): string {
  return new Intl.NumberFormat(document.documentElement.lang || 'en', { maximumFractionDigits: 2 }).format(value);
}

export function valueAxis(theme: ChartTheme, extra: Record<string, unknown> = {}) {
  return {
    type: 'value' as const,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: theme.rule, width: 1 } },
    axisLabel: { color: theme.muted, fontFamily: theme.fontMono, fontSize: 11, formatter: localNumber },
    nameTextStyle: { color: theme.muted, fontSize: 11, align: 'left' as const },
    ...extra,
  };
}

export function categoryAxis(theme: ChartTheme, data?: (string | number)[], extra: Record<string, unknown> = {}) {
  return {
    type: 'category' as const,
    data,
    axisLine: { lineStyle: { color: theme.ruleStrong } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, fontSize: 11, hideOverlap: true },
    ...extra,
  };
}

export function timeAxis(theme: ChartTheme, extra: Record<string, unknown> = {}) {
  return {
    type: 'time' as const,
    axisLine: { lineStyle: { color: theme.ruleStrong } },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { color: theme.muted, fontSize: 11, hideOverlap: true },
    ...extra,
  };
}

/** Bar style per the chart spec: thin, rounded data end, 2px surface gap. */
export function barStyle(color: string, horizontal = false) {
  return {
    color,
    borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
  };
}
