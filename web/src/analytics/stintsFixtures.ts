import { tripId, type Trip } from '../domain/trip';

/** Builds a synthetic trip for tests; only start and end are required. */
export function trip(partial: Partial<Trip> & { start: string; end: string }): Trip {
  const startOdometerKm = partial.startOdometerKm ?? 1000;
  return {
    id: tripId(partial.start, startOdometerKm),
    startAddress: 'Main Street 1, 12345 Town, Country',
    endAddress: 'Main Street 1, 12345 Town, Country',
    distanceKm: 10,
    energyKwh: 2,
    category: 'Private',
    startLat: 50,
    startLon: 10,
    endLat: 50,
    endLon: 10,
    endOdometerKm: startOdometerKm + 10,
    tripType: 'SINGLE',
    socStart: 80,
    socEnd: 78,
    comment: '',
    ...partial,
    startOdometerKm,
  };
}
