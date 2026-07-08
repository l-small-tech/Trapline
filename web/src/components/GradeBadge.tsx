import type { BufferbloatGrade } from '../../../shared/types';
import { Tooltip } from './Tooltip';

const COLORS: Record<string, string> = {
  'A+': 'var(--good)',
  A: 'var(--good)',
  B: 'var(--series-1)',
  C: 'var(--warning)',
  D: 'var(--serious)',
  F: 'var(--critical)',
};

export function GradeBadge({ grade }: { grade: BufferbloatGrade | null }) {
  if (!grade) return <span className="dim">—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span className="badge" style={{ borderColor: COLORS[grade], color: COLORS[grade] }}>
        {grade}
      </span>
      <Tooltip text="Bufferbloat grade: how much extra delay your line suffers while it's busy. A/A+ means calls and gaming stay smooth during downloads; D/F means the connection chokes under load." />
    </span>
  );
}
