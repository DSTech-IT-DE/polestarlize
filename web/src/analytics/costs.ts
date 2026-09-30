import type { Trip } from '../domain/trip';
import { monthKey, monthRange } from './core';

/**
 * Tailpipe CO2 of burning one litre of petrol in kg (about 2.37 kg; diesel would be 2.65 kg).
 * Upstream emissions of fuel production are not included, nor the electricity's manufacturing share.
 */
export const FUEL_CO2_KG_PER_LITRE = 2.37;

/** Average cost per month is only reported for data spanning at least this many days. */
export const MIN_SPAN_DAYS_FOR_MONTHLY_AVERAGE = 28;

/** Average days per month, for turning a span of days into months. */
export const DAYS_PER_MONTH = 365.25 / 12;

/** Months that cover less distance than this do not get a cost per 100 km, it would be noise. */
export const MIN_MONTH_KM = 50;

/** The subset of settings the cost model needs. */
export interface CostAssumptions {
  homePrice: number;
  publicPrice: number;
  /** Share of energy charged at home, 0..1. */
  homeShare: number;
  fuelPrice: number;
  /** l/100 km of the comparison car. */
  fuelConsumption: number;
  chargingLossPercent: number;
  /** g CO2 per kWh of electricity. */
  gridCo2: number;
}

/** Average price per kWh drawn from the grid, given the home/public mix. */
export function blendedPrice(a: Pick<CostAssumptions, 'homePrice' | 'publicPrice' | 'homeShare'>): number {
  return a.homeShare * a.homePrice + (1 - a.homeShare) * a.publicPrice;
}

/** Energy drawn from the grid for a given amount delivered to the battery. */
export function gridEnergy(batteryKwh: number, chargingLossPercent: number): number {
  return batteryKwh * (1 + chargingLossPercent / 100);
}

export interface CostFigures {
  trips: number;
  /** Distance of the trips that report energy. Fuel is compared over the same distance. */
  distanceKm: number;
  batteryKwh: number;
  gridKwh: number;
  electricCost: number;
  fuelLitres: number;
  fuelCost: number;
  /** fuelCost - electricCost, negative when the electric car was more expensive. */
  savings: number;
  co2ElectricKg: number;
  co2PetrolKg: number;
  /** Electric cost per 100 km, null without distance. */
  costPer100Km: number | null;
  fuelCostPer100Km: number | null;
}

/** Cost model for a set of trips. Only trips that report energy are counted, so both sides cover the same distance. */
export function costFigures(trips: readonly Trip[], a: CostAssumptions): CostFigures {
  let count = 0;
  let distanceKm = 0;
  let batteryKwh = 0;
  for (const t of trips) {
    if (t.energyKwh == null || t.distanceKm <= 0) continue;
    count++;
    distanceKm += t.distanceKm;
    batteryKwh += t.energyKwh;
  }
  const gridKwh = gridEnergy(batteryKwh, a.chargingLossPercent);
  const electricCost = gridKwh * blendedPrice(a);
  const fuelLitres = (distanceKm * a.fuelConsumption) / 100;
  const fuelCost = fuelLitres * a.fuelPrice;
  return {
    trips: count,
    distanceKm,
    batteryKwh,
    gridKwh,
    electricCost,
    fuelLitres,
    fuelCost,
    savings: fuelCost - electricCost,
    co2ElectricKg: (gridKwh * a.gridCo2) / 1000,
    co2PetrolKg: fuelLitres * FUEL_CO2_KG_PER_LITRE,
    costPer100Km: distanceKm > 0 ? (electricCost / distanceKm) * 100 : null,
    fuelCostPer100Km: distanceKm > 0 ? (fuelCost / distanceKm) * 100 : null,
  };
}

export interface CostSummary extends CostFigures {
  /** Savings relative to the fuel cost, 0..1; null without fuel cost. */
  savingsShare: number | null;
  costPerTrip: number | null;
  /** Average electric cost per month, null for less than four weeks of data. */
  costPerMonth: number | null;
  co2SavedKg: number;
}

/** Headline figures; `spanDays` is the number of calendar days the data covers. */
export function costSummary(trips: readonly Trip[], a: CostAssumptions, spanDays: number): CostSummary {
  const figures = costFigures(trips, a);
  return {
    ...figures,
    savingsShare: figures.fuelCost > 0 ? figures.savings / figures.fuelCost : null,
    costPerTrip: figures.trips > 0 ? figures.electricCost / figures.trips : null,
    costPerMonth: spanDays >= MIN_SPAN_DAYS_FOR_MONTHLY_AVERAGE ? figures.electricCost / (spanDays / DAYS_PER_MONTH) : null,
    co2SavedKg: figures.co2PetrolKg - figures.co2ElectricKg,
  };
}

export interface MonthCost extends CostFigures {
  /** `YYYY-MM` */
  key: string;
  /** Running sum of savings up to and including this month. */
  cumulativeSavings: number;
  /** Cost per 100 km, null for months with too little distance. */
  reliableCostPer100Km: number | null;
}

/** One row per month including empty months, so time axes have no holes. */
export function monthlyCosts(trips: readonly Trip[], a: CostAssumptions): MonthCost[] {
  if (trips.length === 0) return [];
  const groups = new Map<string, Trip[]>();
  for (const t of trips) {
    const key = monthKey(t);
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const keys = [...groups.keys()].sort();
  let running = 0;
  return monthRange(keys[0], keys[keys.length - 1]).map((key) => {
    const figures = costFigures(groups.get(key) ?? [], a);
    running += figures.savings;
    return {
      ...figures,
      key,
      cumulativeSavings: running,
      reliableCostPer100Km: figures.distanceKm >= MIN_MONTH_KM ? figures.costPer100Km : null,
    };
  });
}

export interface CategoryCost extends CostFigures {
  category: string;
  /** All trips in the category, including those without energy. */
  allTrips: number;
  allDistanceKm: number;
}

/** Cost per trip category, most expensive first, e.g. to reimburse business trips. */
export function categoryCosts(trips: readonly Trip[], a: CostAssumptions): CategoryCost[] {
  const groups = new Map<string, Trip[]>();
  for (const t of trips) {
    const list = groups.get(t.category) ?? [];
    list.push(t);
    groups.set(t.category, list);
  }
  return [...groups.entries()]
    .map(([category, list]) => ({
      category,
      allTrips: list.length,
      allDistanceKm: list.reduce((s, t) => s + t.distanceKm, 0),
      ...costFigures(list, a),
    }))
    .sort((x, y) => y.electricCost - x.electricCost || y.allDistanceKm - x.allDistanceKm);
}
