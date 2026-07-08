/**
 * Minimal stroke icon set, replacing emoji so the UI renders identically
 * on every platform. All icons share a 24px grid and inherit currentColor.
 */
const PATHS: Record<string, JSX.Element> = {
  leaf: (
    <path d="M6 20c0-8 4-13 13-14 0 10-4 14-11 14m-2 0c2-5 5-8 9-10" />
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.7 16.3a6 6 0 0 1 0-8.6m8.6 0a6 6 0 0 1 0 8.6M5 19a10 10 0 0 1 0-14m14 0a10 10 0 0 1 0 14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.5 20h19L12 3zm0 7v4" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </>
  ),
  wifi: (
    <>
      <path d="M2.5 8.5a14 14 0 0 1 19 0M6 12.5a9 9 0 0 1 12 0m-8.7 3.7a4 4 0 0 1 5.4 0" />
      <circle cx="12" cy="19.5" r="1" fill="currentColor" />
    </>
  ),
  plug: (
    <path d="M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V8zm5 8v5" />
  ),
  file: (
    <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4zm0 0v4h4M9.5 12h5m-5 4h5" />
  ),
  download: (
    <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14" />
  ),
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  );
}
