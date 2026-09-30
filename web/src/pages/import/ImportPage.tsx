import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { JourneyLogFormatError, parseJourneyLogFile } from '../../import/parseJourneyLog';
import { useFormat } from '../../lib/format';
import { href } from '../../lib/router';
import { importTrips, isBackup, loadDemoData, restoreBackup, type ImportSummary } from '../../store/repository';
import { useImports } from '../../store/useTrips';
import { UploadIcon } from '../../ui/icons';
import { Page, Section } from '../../ui/Page';
import './import.css';

type Outcome = { kind: 'done'; summary: ImportSummary; files: string[] } | { kind: 'error'; file: string; code: string };

export default function ImportPage() {
  const { t } = useTranslation('import');
  const f = useFormat();
  const imports = useImports();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function handleFiles(list: FileList | File[]) {
    const files = [...list];
    if (files.length === 0) return;
    setBusy(true);
    setOutcome(null);
    try {
      const parsed = [];
      for (const file of files) {
        if (/\.json$/i.test(file.name)) {
          const json = JSON.parse(await file.text()) as unknown;
          if (!isBackup(json)) throw new JourneyLogFormatError('not-journey-log', 'Not a backup file');
          const summary = await restoreBackup(json);
          setOutcome({ kind: 'done', summary, files: [file.name] });
          return;
        }
        try {
          const result = await parseJourneyLogFile(file);
          parsed.push({ fileName: file.name, trips: result.trips, skipped: result.skipped });
        } catch (error) {
          setOutcome({ kind: 'error', file: file.name, code: error instanceof JourneyLogFormatError ? error.code : 'unreadable' });
          return;
        }
      }
      const summary = await importTrips(parsed);
      setOutcome({ kind: 'done', summary, files: files.map((file) => file.name) });
    } catch {
      setOutcome({ kind: 'error', file: files[0].name, code: 'unreadable' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void handleFiles(event.dataTransfer.files);
  }

  return (
    <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <UploadIcon size={22} />
        <div>
          <p className="dropzone-title">{busy ? t('reading') : t('drop')}</p>
          <p className="muted">{t('accepted')}</p>
        </div>
        <button type="button" className="button" disabled={busy} onClick={() => input.current?.click()}>
          {t('choose')}
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx,.json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          hidden
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
      </div>

      {outcome?.kind === 'done' && (
        <div className="note import-result" role="status">
          <strong>{t('result.title', { count: outcome.summary.added })}</strong>{' '}
          {t('result.detail', {
            updated: outcome.summary.updated,
            unchanged: outcome.summary.unchanged,
            replaced: outcome.summary.replaced,
            total: outcome.summary.total,
          })}
          {outcome.summary.skipped > 0 && <> {t('result.skipped', { count: outcome.summary.skipped })}</>}{' '}
          <a href={href('overview')}>{t('result.view')}</a>
        </div>
      )}
      {outcome?.kind === 'error' && (
        <div className="note note-critical import-result" role="alert">
          <strong>{outcome.file}:</strong> {t(`error.${outcome.code}`)}
        </div>
      )}

      <div className="grid grid-2 import-help">
        <Section title={t('how.title')}>
          <ol className="steps">
            <li>{t('how.step1')}</li>
            <li>{t('how.step2')}</li>
            <li>{t('how.step3')}</li>
            <li>{t('how.step4')}</li>
          </ol>
        </Section>
        <Section title={t('incremental.title')}>
          <p className="section-note">{t('incremental.body')}</p>
          <p className="section-note" style={{ marginTop: 10 }}>
            {t('privacy')}
          </p>
          <div style={{ marginTop: 16 }}>
            <button type="button" className="button button-secondary" onClick={() => void loadDemoData().then((summary) => setOutcome({ kind: 'done', summary, files: ['demo'] }))}>
              {t('demo')}
            </button>
          </div>
        </Section>
      </div>

      {imports && imports.length > 0 && (
        <Section title={t('history.title')}>
          <div className="panel panel-flush table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('history.when')}</th>
                  <th>{t('history.files')}</th>
                  <th>{t('history.range')}</th>
                  <th className="num">{t('history.added')}</th>
                  <th className="num">{t('history.updated')}</th>
                  <th className="num">{t('history.replaced')}</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((record) => (
                  <tr key={record.id}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {new Intl.DateTimeFormat(f.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.importedAt))}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {record.fileNames.join(', ')}
                    </td>
                    <td>{record.firstTrip && record.lastTrip ? `${f.date(record.firstTrip)} – ${f.date(record.lastTrip)}` : '–'}</td>
                    <td className="num">{record.added}</td>
                    <td className="num">{record.updated}</td>
                    <td className="num">{record.replaced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </Page>
  );
}
