import { describe, expect, it } from 'vitest';
import { acceptRemoteSettings } from './settings';
import { matchSavedPlace, sanitizeSavedPlaces, withSavedPlace, type SavedPlace } from './savedPlaces';

const work: SavedPlace = { id: 'w', lat: 50, lon: 10, kind: 'work', price: 0, label: 'Factory 1, Town' };

describe('matchSavedPlace', () => {
  it('finds the nearest place within the radius', () => {
    const near: SavedPlace = { ...work, id: 'n', lat: 50.001 };
    expect(matchSavedPlace(50.0009, 10, [work, near])?.id).toBe('n');
    expect(matchSavedPlace(50.01, 10, [work])).toBeNull();
    expect(matchSavedPlace(null, 10, [work])).toBeNull();
  });
});

describe('withSavedPlace', () => {
  it('creates, changes and drops places', () => {
    const created = withSavedPlace([], { lat: 51, lon: 11, label: 'Home 1' }, { kind: 'home' });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ lat: 51, lon: 11, kind: 'home', price: null, label: 'Home 1' });
    const id = created[0].id;

    const priced = withSavedPlace(created, { lat: 51.0001, lon: 11, label: '', savedId: id }, { price: 0.28 });
    expect(priced).toEqual([{ ...created[0], price: 0.28 }]);

    expect(withSavedPlace(priced, { lat: 51, lon: 11, label: '', savedId: id }, { kind: null })[0]).toMatchObject({ kind: null, price: 0.28 });
    // Neither kind nor price left: nothing to remember.
    expect(withSavedPlace([{ ...created[0] }], { lat: 51, lon: 11, label: '', savedId: id }, { kind: null })).toEqual([]);
  });
});

describe('sanitizeSavedPlaces', () => {
  it('keeps valid entries and drops broken ones', () => {
    expect(sanitizeSavedPlaces('nope')).toBeNull();
    expect(
      sanitizeSavedPlaces([work, { ...work, lat: 'x' }, { ...work, kind: 'castle', price: -1 }, { ...work, id: 'p', kind: 'castle', price: 0.4 }, null]),
    ).toEqual([work, { ...work, id: 'p', kind: null, price: 0.4 }]);
  });

  it('is applied to places from a sync server or a backup', () => {
    expect(acceptRemoteSettings({ places: [work, { id: 1 }], priceMix: 'manual' })).toEqual({ places: [work], priceMix: 'manual' });
    expect(acceptRemoteSettings({ places: {}, priceMix: 'guess' })).toEqual({});
  });
});
