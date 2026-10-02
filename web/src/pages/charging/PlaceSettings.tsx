import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { placeKind, placePrice, type ChargingPlace } from '../../analytics/charging';
import type { Formatter } from '../../lib/format';
import { withSavedPlace, type PlaceKind, type SavedPlace } from '../../lib/savedPlaces';
import { getSettings, updateSettings } from '../../lib/settings';

export function saveSavedPlace(position: { lat: number; lon: number; label: string; savedId?: string }, patch: Partial<Pick<SavedPlace, 'kind' | 'price'>>) {
  updateSettings({ places: withSavedPlace(getSettings().places, position, patch) });
}

/** What a place is; empty = let the analysis decide. */
export function KindSelect({ value, emptyLabel, disabled, onChange }: { value: PlaceKind | null; emptyLabel: string; disabled?: boolean; onChange: (kind: PlaceKind | null) => void }) {
  const { t } = useTranslation('charging');
  return (
    <select className="select place-kind" aria-label={t('places.kind')} disabled={disabled} value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as PlaceKind | null)}>
      <option value="">{emptyLabel}</option>
      <option value="home">{t('places.kindHome')}</option>
      <option value="work">{t('places.kindWork')}</option>
      <option value="other">{t('places.kindOther')}</option>
    </select>
  );
}

const toText = (price: number | null, locale: string) =>
  price == null ? '' : price.toLocaleString(locale, { maximumFractionDigits: 4, useGrouping: false });

/**
 * Price per kWh. Committed when the field is left, so typing does not create a
 * settings change per keystroke; an empty field returns to the default price.
 */
export function PriceField({
  value,
  fallback,
  hint,
  disabled,
  f,
  onCommit,
}: {
  value: number | null;
  fallback: number;
  hint: string;
  disabled?: boolean;
  f: Formatter;
  onCommit: (price: number | null) => void;
}) {
  const { t } = useTranslation('charging');
  const [text, setText] = useState(toText(value, f.locale));
  useEffect(() => setText(toText(value, f.locale)), [value, f.locale]);

  const commit = () => {
    const trimmed = text.trim().replace(',', '.');
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
      setText(toText(value, f.locale));
      return;
    }
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <input
      className="input num place-price"
      type="text"
      inputMode="decimal"
      aria-label={t('places.price')}
      disabled={disabled}
      value={text}
      placeholder={f.number(fallback, 2)}
      title={hint}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function positionOf(place: ChargingPlace) {
  return { lat: place.lat!, lon: place.lon!, label: place.label, savedId: place.saved?.id };
}

export function PlaceKindSelect({ place }: { place: ChargingPlace }) {
  const { t } = useTranslation('charging');
  return (
    <KindSelect
      value={place.saved?.kind ?? null}
      emptyLabel={place.likelyHome ? t('places.kindDetectedHome') : t('places.kindNone')}
      disabled={place.lat == null}
      onChange={(kind) => saveSavedPlace(positionOf(place), { kind })}
    />
  );
}

export function PlacePriceInput({ place, prices, f }: { place: ChargingPlace; prices: { homePrice: number; publicPrice: number }; f: Formatter }) {
  const { t } = useTranslation('charging');
  const fallback = placePrice({ saved: place.saved && { ...place.saved, price: null }, likelyHome: place.likelyHome }, prices);
  return (
    <PriceField
      value={place.saved?.price ?? null}
      fallback={fallback}
      hint={t(placeKind(place) === 'home' ? 'places.priceDefaultHome' : 'places.priceDefaultPublic')}
      disabled={place.lat == null}
      f={f}
      onCommit={(price) => saveSavedPlace(positionOf(place), { price })}
    />
  );
}
