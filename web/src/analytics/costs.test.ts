import { describe, expect, it } from 'vitest';
import type { Trip } from '../domain/trip';
import { blendedPrice, categoryCosts, costFigures, costSummary, FUEL_CO2_KG_PER_LITRE, gridEnergy, monthlyCosts, type CostAssumptions } from './costs';

const A: CostAssumptions = { homePrice: 0.3, publicPrice: 0.6, homeShare: 0.75, fuelPrice: 2, fuelConsumption: 7, chargingLossPercent: 10, gridCo2: 400 };

let counter = 0;
function trip(start: string, distanceKm: number, energyKwh: number | null, category = 'Private'): Trip {
  return {
    id: String(counter++),
    start,
    end: start,
    startAddress: '',
    endAddress: '',
    distanceKm,
    energyKwh,
    category,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startOdometerKm: null,
    endOdometerKm: null,
    tripType: 'SINGLE',
    socStart: null,
    socEnd: null,
    comment: '',
  };
}

describe('price model', () => {
  it('blends home and public prices', () => {
    expect(blendedPrice(A)).toBeCloseTo(0.375);
    expect(blendedPrice({ ...A, homeShare: 1 })).toBeCloseTo(0.3);
    expect(blendedPrice({ ...A, homeShare: 0 })).toBeCloseTo(0.6);
  });

  it('adds the charging loss on top of the battery energy', () => {
    expect(gridEnergy(100, 10)).toBeCloseTo(110);
    expect(gridEnergy(100, 0)).toBe(100);
  });
});

describe('costFigures', () => {
  it('computes cost, fuel comparison and CO2 over the same distance', () => {
    const f = costFigures([trip('2026-01-05T08:00', 100, 20), trip('2026-01-06T08:00', 100, 20), trip('2026-01-07T08:00', 500, null)], A);
    expect(f.trips).toBe(2);
    expect(f.distanceKm).toBe(200);
    expect(f.batteryKwh).toBe(40);
    expect(f.gridKwh).toBeCloseTo(44);
    expect(f.electricCost).toBeCloseTo(44 * 0.375);
    expect(f.fuelLitres).toBeCloseTo(14);
    expect(f.fuelCost).toBeCloseTo(28);
    expect(f.savings).toBeCloseTo(28 - 16.5);
    expect(f.co2ElectricKg).toBeCloseTo(17.6);
    expect(f.co2PetrolKg).toBeCloseTo(14 * FUEL_CO2_KG_PER_LITRE);
    expect(f.costPer100Km).toBeCloseTo(8.25);
    expect(f.fuelCostPer100Km).toBeCloseTo(14);
  });

  it('handles empty input', () => {
    expect(costFigures([], A)).toMatchObject({ trips: 0, electricCost: 0, costPer100Km: null, fuelCostPer100Km: null });
  });
});

describe('costSummary', () => {
  const trips = [trip('2026-01-05T08:00', 100, 20), trip('2026-02-05T08:00', 100, 20)];
  it('derives shares and averages', () => {
    const s = costSummary(trips, A, 61);
    expect(s.savingsShare).toBeCloseTo((28 - 16.5) / 28);
    expect(s.costPerTrip).toBeCloseTo(8.25);
    expect(s.costPerMonth).toBeCloseTo(16.5 / (61 / (365.25 / 12)));
    expect(s.co2SavedKg).toBeCloseTo(s.co2PetrolKg - s.co2ElectricKg);
  });

  it('reports no monthly average for very short spans', () => {
    expect(costSummary(trips, A, 10).costPerMonth).toBeNull();
  });

  it('reports negative savings when electricity is pricier', () => {
    expect(costSummary(trips, { ...A, fuelPrice: 0.5 }, 61).savings).toBeLessThan(0);
  });
});

describe('monthlyCosts', () => {
  it('fills gaps and accumulates savings', () => {
    const rows = monthlyCosts([trip('2026-01-05T08:00', 100, 20), trip('2026-03-05T08:00', 100, 20)], A);
    expect(rows.map((r) => r.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(rows[1]).toMatchObject({ trips: 0, electricCost: 0, reliableCostPer100Km: null });
    expect(rows[2].cumulativeSavings).toBeCloseTo(2 * (28 / 2 - 16.5 / 2));
    expect(rows[0].reliableCostPer100Km).toBeCloseTo(8.25);
  });

  it('returns nothing without trips', () => {
    expect(monthlyCosts([], A)).toEqual([]);
  });
});

describe('categoryCosts', () => {
  it('splits cost by category and keeps trips without energy in the distance', () => {
    const rows = categoryCosts([trip('2026-01-05T08:00', 50, 10, 'Business'), trip('2026-01-05T09:00', 100, 30, 'Private'), trip('2026-01-05T10:00', 20, null, 'Business')], A);
    expect(rows.map((r) => r.category)).toEqual(['Private', 'Business']);
    expect(rows[1]).toMatchObject({ allTrips: 2, allDistanceKm: 70, trips: 1, distanceKm: 50 });
    expect(rows[1].electricCost).toBeCloseTo(10 * 1.1 * 0.375);
  });
});
