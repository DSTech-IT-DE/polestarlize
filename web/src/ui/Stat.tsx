import type { ReactNode } from 'react';

export function Stat({ label, value, unit, hint, accent }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={accent ? 'stat stat-accent' : 'stat'}>
      <div className="label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="stats">{children}</div>;
}
