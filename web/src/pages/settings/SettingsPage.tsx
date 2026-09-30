import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../../i18n';
import { toJourneyLogCsv } from '../../import/exportCsv';
import { getUserId } from '../../lib/identity';
import { updateSettings, useSettings, type Settings } from '../../lib/settings';
import { CUSTOM_VEHICLE, VEHICLES } from '../../lib/vehicles';
import { useDataset } from '../../store/dataset';
import { createBackup, deleteAllTrips, stripStorage } from '../../store/repository';
import { AccountPanel } from '../../sync/AccountPanel';
import { DownloadIcon } from '../../ui/icons';
import { Page, Section } from '../../ui/Page';
import { Segmented } from '../../ui/Segmented';
import './settings.css';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function NumberField({ label, hint, value, step, min, max, onChange, suffix }: {
  label: string;
  hint?: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <span className="input-suffix">
        <input
          className="input num"
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) onChange(v);
          }}
        />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

const CURRENCIES = ['EUR', 'CHF', 'GBP', 'SEK', 'NOK', 'DKK', 'USD'];

export default function SettingsPage() {
  const { t, i18n } = useTranslation('settings');
  const settings = useSettings();
  const { allTrips } = useDataset();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
      <Section title={t('account.title')} note={t('account.note')}>
        <AccountPanel />
      </Section>

      <Section title={t('display.title')}>
        <div className="settings-grid">
          <div className="field">
            <span className="label">{t('display.language')}</span>
            <Segmented
              label={t('display.language')}
              value={i18n.resolvedLanguage ?? 'en'}
              options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
              onChange={(v) => void i18n.changeLanguage(v)}
            />
          </div>
          <div className="field">
            <span className="label">{t('display.theme')}</span>
            <Segmented
              label={t('display.theme')}
              value={settings.theme}
              options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: t(`display.themes.${v}`) }))}
              onChange={(theme) => set({ theme })}
            />
          </div>
          <div className="field">
            <span className="label">{t('display.units')}</span>
            <Segmented
              label={t('display.units')}
              value={settings.distanceUnit}
              options={[
                { value: 'km', label: t('display.km') },
                { value: 'mi', label: t('display.mi') },
              ]}
              onChange={(distanceUnit) => set({ distanceUnit })}
            />
          </div>
        </div>
      </Section>

      <Section title={t('vehicle.title')} note={t('vehicle.note')}>
        <div className="settings-grid">
          <label className="field">
            <span className="label">{t('vehicle.model')}</span>
            <select
              className="select"
              value={settings.vehicle}
              onChange={(e) => {
                const vehicle = VEHICLES.find((v) => v.id === e.target.value);
                set({ vehicle: e.target.value, ...(vehicle ? { usableCapacityKwh: vehicle.usableKwh } : {}) });
              }}
            >
              {VEHICLES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
              <option value={CUSTOM_VEHICLE}>{t('vehicle.custom')}</option>
            </select>
          </label>
          <NumberField
            label={t('vehicle.capacity')}
            hint={t('vehicle.capacityHint')}
            value={settings.usableCapacityKwh}
            step={0.5}
            min={20}
            max={200}
            suffix="kWh"
            onChange={(usableCapacityKwh) => set({ usableCapacityKwh, vehicle: CUSTOM_VEHICLE })}
          />
        </div>
      </Section>

      <Section title={t('prices.title')} note={t('prices.note')}>
        <div className="settings-grid">
          <label className="field">
            <span className="label">{t('prices.currency')}</span>
            <select className="select" value={settings.currency} onChange={(e) => set({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <NumberField label={t('prices.home')} value={settings.homePrice} step={0.01} min={0} suffix={`${settings.currency}/kWh`} onChange={(homePrice) => set({ homePrice })} />
          <NumberField label={t('prices.public')} value={settings.publicPrice} step={0.01} min={0} suffix={`${settings.currency}/kWh`} onChange={(publicPrice) => set({ publicPrice })} />
          <NumberField
            label={t('prices.homeShare')}
            hint={t('prices.homeShareHint')}
            value={Math.round(settings.homeShare * 100)}
            step={5}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => set({ homeShare: Math.min(1, Math.max(0, v / 100)) })}
          />
          <NumberField label={t('prices.fuel')} value={settings.fuelPrice} step={0.01} min={0} suffix={`${settings.currency}/l`} onChange={(fuelPrice) => set({ fuelPrice })} />
          <NumberField label={t('prices.fuelConsumption')} value={settings.fuelConsumption} step={0.1} min={0} suffix="l/100 km" onChange={(fuelConsumption) => set({ fuelConsumption })} />
        </div>
      </Section>

      <Section title={t('data.title')} note={t('data.note', { count: allTrips.length })}>
        <div className="page-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void createBackup(getUserId()).then((backup) => download(`polestarlize-backup-${stamp}.json`, JSON.stringify(backup), 'application/json'))}
          >
            <DownloadIcon /> {t('data.backup')}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={allTrips.length === 0}
            onClick={() => download(`journey-log-${stamp}.csv`, toJourneyLogCsv(allTrips.map(stripStorage)), 'text/csv;charset=utf-8')}
          >
            <DownloadIcon /> {t('data.csv')}
          </button>
          {!confirmDelete ? (
            <button type="button" className="button button-danger" disabled={allTrips.length === 0} onClick={() => setConfirmDelete(true)}>
              {t('data.delete')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button button-danger"
                onClick={() => void deleteAllTrips({ propagate: true }).then(() => setConfirmDelete(false))}
              >
                {t('data.deleteConfirm', { count: allTrips.length })}
              </button>
              <button type="button" className="button button-secondary" onClick={() => setConfirmDelete(false)}>
                {t('data.cancel')}
              </button>
            </>
          )}
        </div>
      </Section>

      <Section title={t('privacy.title')}>
        <div className="prose">
          <p>{t('privacy.p1')}</p>
          <p>{t('privacy.p2')}</p>
          <p>{t('privacy.p3')}</p>
        </div>
      </Section>
    </Page>
  );
}
