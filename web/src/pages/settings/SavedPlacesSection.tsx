import { useTranslation } from 'react-i18next';
import { useFormat } from '../../lib/format';
import { href } from '../../lib/router';
import { updateSettings, useSettings } from '../../lib/settings';
import { Section } from '../../ui/Page';
import { KindSelect, PriceField, saveSavedPlace } from '../charging/PlaceSettings';

/** Every place the user described, also the ones without sessions in the selected period. */
export function SavedPlacesSection() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('charging');
  const f = useFormat();
  const { places, homePrice, publicPrice, currency } = useSettings();

  return (
    <Section title={t('places.title')} note={t('places.note')}>
      {places.length === 0 ? (
        <p className="section-note">
          {t('places.empty')} <a href={href('charging')}>{t('places.toCharging')} →</a>
        </p>
      ) : (
        <div className="panel panel-flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{tc('places.place')}</th>
                <th>{tc('places.kind')}</th>
                <th className="num">{tc('places.priceHead', { currency })}</th>
                <th>
                  <span className="visually-hidden">{t('places.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {places.map((p) => {
                const position = { lat: p.lat, lon: p.lon, label: p.label, savedId: p.id };
                return (
                  <tr key={p.id}>
                    <td>
                      {p.label || tc('places.unknown')}
                      <div className="mono muted" style={{ fontSize: 12 }}>
                        {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                      </div>
                    </td>
                    <td>
                      <KindSelect value={p.kind} emptyLabel={tc('places.kindNone')} onChange={(kind) => saveSavedPlace(position, { kind })} />
                    </td>
                    <td className="num">
                      <PriceField
                        value={p.price}
                        fallback={p.kind === 'home' ? homePrice : publicPrice}
                        hint={tc(p.kind === 'home' ? 'places.priceDefaultHome' : 'places.priceDefaultPublic')}
                        f={f}
                        onCommit={(price) => saveSavedPlace(position, { price })}
                      />
                    </td>
                    <td className="num">
                      <button type="button" className="button button-secondary button-small" onClick={() => updateSettings({ places: places.filter((x) => x.id !== p.id) })}>
                        {t('places.remove')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
