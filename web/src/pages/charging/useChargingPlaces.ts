import { useMemo } from 'react';
import { capacitySamples, recentCapacity } from '../../analytics/battery';
import { chargingPlaces, chargingSessions, priceMix } from '../../analytics/charging';
import { buildStints } from '../../analytics/stints';
import type { Trip } from '../../domain/trip';
import { useSettings } from '../../lib/settings';
import { useDataset } from '../../store/dataset';

/** Charging sessions and places of the given trips, shared by the charging and the costs page. */
export function useChargingPlaces(trips: readonly Trip[]) {
  const { allTrips } = useDataset();
  const { usableCapacityKwh: nominal, places: saved, homePrice, publicPrice } = useSettings();

  // Energy per SOC point depends on the usable capacity; prefer the measured one over the nominal value.
  const measured = useMemo(() => recentCapacity(capacitySamples(allTrips)), [allTrips]);
  const capacity = measured?.capacityKwh ?? nominal;

  const stints = useMemo(() => buildStints(trips), [trips]);
  const sessions = useMemo(() => chargingSessions(stints, capacity), [stints, capacity]);
  const places = useMemo(() => chargingPlaces(sessions, saved), [sessions, saved]);
  const mix = useMemo(() => priceMix(places, { homePrice, publicPrice }), [places, homePrice, publicPrice]);
  return { measured, capacity, stints, sessions, places, mix };
}
