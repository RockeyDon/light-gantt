import type { CSSProperties } from 'react';

const paths = {
  plus: 'M12 5v14M5 12h14',
  left: 'm14 6-6 6 6 6',
  right: 'm10 6 6 6-6 6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  calendar: 'M8 3v4M16 3v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z',
  archive: 'M4 9h16v11H4ZM3 4h18v5H3ZM10 13h4',
  undo: 'M4 10h9a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  warning: 'm12 3 10 18H2L12 3ZM12 9v5M12 17v.1',
};

export function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
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
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
