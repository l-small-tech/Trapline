import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export function StatTile({
  label,
  value,
  note,
  help,
  children,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** Plain-language explanation shown in the (i) tooltip. */
  help?: string;
  children?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="tile-label">
        {label}
        {help && <Tooltip text={help} />}
      </div>
      <div className="tile-value">{value}</div>
      {note && <div className="tile-note">{note}</div>}
      {children}
    </div>
  );
}
