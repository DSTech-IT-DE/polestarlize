import { toDate, type Trip } from '../domain/trip';
import { median, monthKey } from './core';

/** A trip must use at least this many SOC points to count: one point of rounding is then at most ~15 % noise. */
export const MIN_TRIP_DELTA_SOC = 6;
/** A month is only estimated when its counted trips add up to this many SOC points. */
export const MIN_MONTH_DELTA_SOC = 40;
/** Only long discharges are drawn in the per-trip scatter; they carry the least rounding noise. */
export const SCATTER_MIN_DELTA_SOC = 15;
/** Window of the "recent" estimate. */
export const RECENT_DAYS = 90;
/** Width of the SOC histogram bins in percentage points. */
export const SOC_BIN = 5;
/** 95 % normal interval. */
const Z95 = 1.96;

/** What one trip implies about the usable capacity: energy drawn / SOC points lost × 100. */
export interface CapacitySample {
  id: string;
  start: string;
  energyKwh: number;
  deltaSoc: number;
  capacityKwh: number;
}

export function capacitySamples(trips: readonly Trip[], minDeltaSoc = MIN_TRIP_DELTA_SOC): CapacitySample[] {
  const out: CapacitySample[] = [];
  for (const t of trips) {
    if (t.energyKwh == null || t.energyKwh <= 0 || t.socStart == null || t.socEnd == null) continue;
    const deltaSoc = t.socStart - t.socEnd;
    if (deltaSoc < minDeltaSoc) continue;
    out.push({ id: t.id, start: t.start, energyKwh: t.energyKwh, deltaSoc, capacityKwh: (t.energyKwh / deltaSoc) * 100 });
  }
  return out;
}

export interface CapacityEstimate {
  capacityKwh: number;
  /** Lower end of the approximate 95 % interval (sampling noise only, not systematic offsets). */
  low: number;
  high: number;
  /** Number of trips behind the estimate. */
  n: number;
  /** Total SOC points behind the estimate. */
  sumDeltaSoc: number;
}

/**
 * Energy-weighted capacity: R = Σenergy / ΣΔSOC × 100. Averaging per-trip ratios would
 * over-weight short trips whose integer SOC rounding dominates; the pooled ratio does not.
 *
 * The band is the textbook linearised standard error of a ratio estimator: with
 * residuals r_i = E_i − R·D_i, Var(R) ≈ n/(n−1) · Σ r_i² / (ΣD)², reported as ±1.96 σ.
 * It is deterministic (no resampling) and grows automatically when the per-trip
 * ratios scatter more, e.g. because of rounding. It does not cover systematic
 * offsets such as the SOC display buffer.
 */
export function estimateCapacity(samples: readonly CapacitySample[]): CapacityEstimate | null {
  const n = samples.length;
  let sumE = 0;
  let sumD = 0;
  for (const s of samples) {
    sumE += s.energyKwh;
    sumD += s.deltaSoc;
  }
  if (n === 0 || sumD <= 0) return null;
  const ratio = sumE / sumD;
  let sse = 0;
  for (const s of samples) sse += (s.energyKwh - ratio * s.deltaSoc) ** 2;
  const se = n > 1 ? Math.sqrt(((n / (n - 1)) * sse) / (sumD * sumD)) : 0;
  const capacityKwh = ratio * 100;
  return { capacityKwh, low: capacityKwh - Z95 * se * 100, high: capacityKwh + Z95 * se * 100, n, sumDeltaSoc: sumD };
}

export interface MonthlyCapacity extends CapacityEstimate {
  /** `YYYY-MM`. */
  key: string;
}

/** One estimate per calendar month, skipping months with too little discharge to be meaningful. */
export function monthlyCapacity(samples: readonly CapacitySample[], minSumDeltaSoc = MIN_MONTH_DELTA_SOC): MonthlyCapacity[] {
  const groups = new Map<string, CapacitySample[]>();
  for (const s of samples) {
    const key = monthKey(s);
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(s);
  }
  const out: MonthlyCapacity[] = [];
  for (const [key, list] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const est = estimateCapacity(list);
    if (est && est.sumDeltaSoc >= minSumDeltaSoc) out.push({ key, ...est });
  }
  return out;
}

export interface RecentCapacity extends CapacityEstimate {
  /** Length of the window actually used; null = all data (the last 90 days were too thin). */
  windowDays: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
function daysBefore(local: string, days: number): string {
  const d = toDate(local);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
}

/** Estimate from the most recent window; falls back to all samples when the window holds too little discharge. */
export function recentCapacity(samples: readonly CapacitySample[], days = RECENT_DAYS, minSumDeltaSoc = MIN_MONTH_DELTA_SOC): RecentCapacity | null {
  if (samples.length === 0) return null;
  const latest = samples.reduce((max, s) => (s.start > max ? s.start : max), samples[0].start);
  const from = daysBefore(latest, days);
  const windowEst = estimateCapacity(samples.filter((s) => s.start >= from));
  if (windowEst && windowEst.sumDeltaSoc >= minSumDeltaSoc) return { ...windowEst, windowDays: days };
  const all = estimateCapacity(samples);
  return all && all.sumDeltaSoc >= minSumDeltaSoc ? { ...all, windowDays: null } : null;
}

export interface CapacityTrend {
  /** Change of the estimated capacity per year in kWh (negative = fading). */
  kwhPerYear: number;
  /** The same as a share of the fitted mean capacity. */
  percentPerYear: number;
  /** One standard error of `kwhPerYear`. */
  kwhPerYearSe: number;
  /** True when the slope is more than two standard errors away from zero. */
  significant: boolean;
  /** Fitted values at the first and last month, for drawing the line. */
  line: { from: { key: string; kwh: number }; to: { key: string; kwh: number } };
  months: number;
}

export const MIN_TREND_MONTHS = 4;
export const MIN_TREND_SPAN_MONTHS = 3;

const monthIndex = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
};

/**
 * Weighted least squares of monthly estimates over time, weighted by ΣΔSOC (more
 * discharge → a more reliable month). Needs at least 4 months spanning 3 months,
 * otherwise a slope would mostly describe noise.
 */
export function capacityTrend(months: readonly MonthlyCapacity[]): CapacityTrend | null {
  if (months.length < MIN_TREND_MONTHS) return null;
  const idx = months.map((m) => monthIndex(m.key));
  if (idx[idx.length - 1] - idx[0] < MIN_TREND_SPAN_MONTHS) return null;
  const x = idx.map((i) => i / 12);
  const w = months.map((m) => m.sumDeltaSoc);
  const sw = w.reduce((a, b) => a + b, 0);
  const xm = x.reduce((a, xi, i) => a + w[i] * xi, 0) / sw;
  const ym = months.reduce((a, m, i) => a + w[i] * m.capacityKwh, 0) / sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < months.length; i++) {
    sxx += w[i] * (x[i] - xm) ** 2;
    sxy += w[i] * (x[i] - xm) * (months[i].capacityKwh - ym);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < months.length; i++) sse += w[i] * (months[i].capacityKwh - (ym + slope * (x[i] - xm))) ** 2;
  // Residual variance per unit weight; standard error of the slope follows from it.
  const se = Math.sqrt(sse / (months.length - 2) / sxx);
  const at = (i: number) => ym + slope * (x[i] - xm);
  const last = months.length - 1;
  return {
    kwhPerYear: slope,
    percentPerYear: (slope / ym) * 100,
    kwhPerYearSe: se,
    significant: Math.abs(slope) > 2 * se,
    line: { from: { key: months[0].key, kwh: at(0) }, to: { key: months[last].key, kwh: at(last) } },
    months: months.length,
  };
}

/** Estimated capacity as a share of the nominal usable capacity. May exceed 1, see the page text. */
export function stateOfHealth(capacityKwh: number, nominalKwh: number): number | null {
  return nominalKwh > 0 ? capacityKwh / nominalKwh : null;
}

export interface SocUsage {
  /** Trips with both SOC values. */
  trips: number;
  /** Counts per `SOC_BIN`-wide bin (0–4, 5–9, … 95–100) of the SOC at trip start / end. */
  startHistogram: number[];
  endHistogram: number[];
  shareStartAtLeast90: number | null;
  shareEndAtMost20: number | null;
  /** Lowest SOC at the end of any trip. */
  minSoc: number | null;
  /** Median over days of the SOC at the first departure / the last arrival. */
  medianDayStart: number | null;
  medianDayEnd: number | null;
  days: number;
  energyKwh: number;
  /** Energy throughput divided by the nominal capacity. */
  equivalentCycles: number | null;
}

export function socUsage(trips: readonly Trip[], nominalKwh: number): SocUsage {
  const bins = Math.ceil(100 / SOC_BIN);
  const binOf = (soc: number) => Math.min(bins - 1, Math.max(0, Math.floor(soc / SOC_BIN)));
  const startHistogram = new Array<number>(bins).fill(0);
  const endHistogram = new Array<number>(bins).fill(0);
  let counted = 0;
  let high = 0;
  let low = 0;
  let minSoc: number | null = null;
  let energyKwh = 0;
  // First/last trip of each day, trips arrive in any order so compare start strings.
  const firstOfDay = new Map<string, { start: string; soc: number }>();
  const lastOfDay = new Map<string, { start: string; soc: number }>();
  for (const t of trips) {
    if (t.energyKwh != null) energyKwh += t.energyKwh;
    if (t.socStart == null || t.socEnd == null) continue;
    counted++;
    startHistogram[binOf(t.socStart)]++;
    endHistogram[binOf(t.socEnd)]++;
    if (t.socStart >= 90) high++;
    if (t.socEnd <= 20) low++;
    if (minSoc == null || t.socEnd < minSoc) minSoc = t.socEnd;
    const day = t.start.slice(0, 10);
    const first = firstOfDay.get(day);
    if (!first || t.start < first.start) firstOfDay.set(day, { start: t.start, soc: t.socStart });
    const last = lastOfDay.get(day);
    if (!last || t.start > last.start) lastOfDay.set(day, { start: t.start, soc: t.socEnd });
  }
  return {
    trips: counted,
    startHistogram,
    endHistogram,
    shareStartAtLeast90: counted ? high / counted : null,
    shareEndAtMost20: counted ? low / counted : null,
    minSoc,
    medianDayStart: median([...firstOfDay.values()].map((v) => v.soc)),
    medianDayEnd: median([...lastOfDay.values()].map((v) => v.soc)),
    days: firstOfDay.size,
    energyKwh,
    equivalentCycles: nominalKwh > 0 ? energyKwh / nominalKwh : null,
  };
}
