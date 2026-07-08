import { useId, useState } from 'react';

/**
 * Plain-language help attached to a metric: a small (i) that shows an
 * explanation on hover or keyboard focus. Used on every stat so
 * non-technical users always have a "what does this mean?" one click away.
 */
export function Tooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="tt-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="tt-icon"
        aria-label="What does this mean?"
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <span role="tooltip" id={id} className="tt-pop">
          {text}
        </span>
      )}
    </span>
  );
}
