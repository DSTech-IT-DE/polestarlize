import type { ReactNode } from 'react';

export function Page({
  index,
  overline,
  title,
  lead,
  actions,
  children,
}: {
  /** Two digit section number shown in the overline, e.g. "03". */
  index?: string;
  overline: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article>
      <header className="page-header">
        <div>
          <span className="overline">
            {index ? `${index} — ` : ''}
            {overline}
          </span>
          <h1 className="page-title">{title}</h1>
          {lead && <p className="page-lead">{lead}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </article>
  );
}

export function Section({ title, note, aside, children, id }: { title: string; note?: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <div className="section-head">
        <div>
          <h2 className="section-title">{title}</h2>
          {note && <p className="section-note">{note}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Panel({ title, aside, children, flush }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <div className={flush ? 'panel panel-flush' : 'panel'}>
      {(title || aside) && (
        <div className="panel-title">
          <span>{title}</span>
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}
