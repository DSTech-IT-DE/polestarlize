import type { TFunction } from 'i18next';
import type { Place } from '../../analytics/places';
import type { Formatter } from '../../lib/format';
import { href } from '../../lib/router';

/** Duration with days once it gets long, e.g. "9 h 05 min" or "3 d". */
export function dwellText(minutes: number, f: Formatter, t: TFunction): string {
  if (minutes >= 2 * 24 * 60) return t('units.days', { ns: 'common', count: Math.round(minutes / 1440) });
  return f.duration(minutes);
}

/** Built with DOM calls, never innerHTML: addresses come from imported files. */
export function buildPlacePopup(place: Place, f: Formatter, t: TFunction): HTMLElement {
  const root = document.createElement('div');
  root.className = 'place-popup';

  const title = document.createElement('strong');
  title.textContent = place.label;
  root.append(title);

  if (place.isHome || place.isWork) {
    const tag = document.createElement('span');
    tag.className = 'tag tag-accent';
    tag.textContent = place.isHome ? t('home') : t('work');
    root.append(' ', tag);
  }

  const address = document.createElement('div');
  address.className = 'place-popup-address';
  address.textContent = place.address;
  root.append(address);

  const rows: [string, string][] = [
    [t('col.visits'), f.number(place.visits)],
    [t('col.dwell'), place.dwellMedianMin == null ? '–' : dwellText(place.dwellMedianMin, f, t)],
    [t('col.first'), f.date(place.firstVisit)],
    [t('col.last'), f.date(place.lastVisit)],
  ];
  const dl = document.createElement('dl');
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  root.append(dl);

  const link = document.createElement('a');
  link.href = href('trips', { place: place.id });
  link.textContent = `${t('showTrips')} →`;
  root.append(link);
  return root;
}
