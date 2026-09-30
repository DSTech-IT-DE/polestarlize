import { Suspense, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';
import { APP_COMMIT, APP_VERSION, REPOSITORY_NAME, REPOSITORY_URL } from '../lib/buildInfo';
import { href, type RouteId } from '../lib/router';
import { updateSettings, useSettings, type ThemePreference } from '../lib/settings';
import { useDataset } from '../store/dataset';
import { SyncStatus } from '../sync/SyncStatus';
import { refreshChartTheme } from './chart/theme';
import { GitHubIcon, LogoMark, MoonIcon, SunIcon, SystemIcon } from './icons';

const NAV: { group: 'analyse' | 'data'; routes: RouteId[] }[] = [
  { group: 'analyse', routes: ['overview', 'trips', 'map', 'battery', 'charging', 'driving', 'costs'] },
  { group: 'data', routes: ['import', 'settings'] },
];

function useApplyTheme(theme: ThemePreference) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    refreshChartTheme();
  }, [theme]);
}

function RepoLink() {
  return (
    <a className="repo-link" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
      <GitHubIcon size={16} />
      <span className="repo-name">{REPOSITORY_NAME}</span>
    </a>
  );
}

function VersionLabel() {
  return (
    <span className="version" title={`commit ${APP_COMMIT}`}>
      v{APP_VERSION} · {APP_COMMIT}
    </span>
  );
}

function PeriodSelect() {
  const { t } = useTranslation();
  const { period, setPeriod, years, allTrips } = useDataset();
  if (allTrips.length === 0) return <span />;
  return (
    <label className="period-select">
      <span className="visually-hidden">{t('period.label')}</span>
      <select className="select" value={period} onChange={(e) => setPeriod(e.target.value)}>
        <option value="all">{t('period.all')}</option>
        <option value="12m">{t('period.12m')}</option>
        <option value="90d">{t('period.90d')}</option>
        <option value="30d">{t('period.30d')}</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}

const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark'];

function Controls() {
  const { t, i18n } = useTranslation();
  const { theme } = useSettings();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  const Icon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : SystemIcon;
  return (
    <div className="topbar-controls">
      <SyncStatus />
      <label>
        <span className="visually-hidden">{t('language')}</span>
        <select className="select select-compact" value={i18n.resolvedLanguage} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.code.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="icon-button"
        onClick={() => updateSettings({ theme: next })}
        title={t('theme.current', { theme: t(`theme.${theme}`) })}
        aria-label={t('theme.switchTo', { theme: t(`theme.${next}`) })}
      >
        <Icon />
      </button>
    </div>
  );
}

export function Shell({ route, children }: { route: RouteId; children: ReactNode }) {
  const { t } = useTranslation();
  const { theme } = useSettings();
  useApplyTheme(theme);

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href={href('overview')}>
          <LogoMark />
          <span>polestarlize</span>
        </a>
        <nav className="nav" aria-label={t('nav.label')}>
          {NAV.map((group) => (
            <div key={group.group} style={{ display: 'contents' }}>
              <div className="nav-group-label">{t(`nav.group.${group.group}`)}</div>
              {group.routes.map((r, i) => (
                <a key={r} href={href(r)} aria-current={r === route ? 'page' : undefined}>
                  <span className="nav-index">{group.group === 'analyse' ? String(i + 1).padStart(2, '0') : '··'}</span>
                  <span>{t(`nav.${r}`)}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <RepoLink />
          <VersionLabel />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <a className="brand topbar-mobile-brand" href={href('overview')}>
            <LogoMark size={20} />
            <span>polestarlize</span>
          </a>
          <PeriodSelect />
          <Controls />
        </header>
        <main className="content">
          <Suspense fallback={<div className="muted">{t('loading')}</div>}>{children}</Suspense>
        </main>
        <footer className="site-footer">
          <RepoLink />
          <VersionLabel />
          <span>{t('footer.license')}</span>
          <span>{t('footer.disclaimer')}</span>
        </footer>
      </div>
    </div>
  );
}
