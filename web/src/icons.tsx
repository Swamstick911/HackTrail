import type { SVGProps } from 'react';

type IconName =
  | 'trail'
  | 'plus'
  | 'upload'
  | 'download'
  | 'search'
  | 'close'
  | 'arrow'
  | 'folder'
  | 'shield'
  | 'code'
  | 'clock'
  | 'activity'
  | 'review'
  | 'connect'
  | 'pause'
  | 'play'
  | 'note'
  | 'chevron'
  | 'check';
const paths: Record<IconName, string[]> = {
  trail: ['M6 4v10a4 4 0 0 0 4 4h7', 'M14 14l4 4-4 4', 'M6 4h12v6H6'],
  plus: ['M12 5v14', 'M5 12h14'],
  upload: ['M12 16V3', 'M7 8l5-5 5 5', 'M4 15v5h16v-5'],
  download: ['M12 3v13', 'M7 11l5 5 5-5', 'M4 17v4h16v-4'],
  search: ['M21 21l-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  arrow: ['M5 12h14', 'M14 7l5 5-5 5'],
  folder: ['M3 6h7l2 3h9v11H3z'],
  shield: ['M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z', 'M8 12l3 3 5-6'],
  code: ['M8 6l-6 6 6 6', 'M16 6l6 6-6 6'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 7v5l3 2'],
  activity: ['M3 12h4l3-7 4 14 3-7h4'],
  review: ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 12h7', 'M9 16h5'],
  connect: ['M9 3v5', 'M15 3v5', 'M6 8h12v3a6 6 0 0 1-12 0z', 'M12 17v4'],
  pause: ['M8 5v14', 'M16 5v14'],
  play: ['M7 4l13 8-13 8z'],
  note: ['M12 4H4v16h16v-8', 'M10 14l1-5L19 1l4 4-8 8z'],
  chevron: ['M9 5l7 7-7 7'],
  check: ['M5 12l4 4L19 6'],
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name].map((path, index) => (
        <path d={path} key={index} />
      ))}
    </svg>
  );
}
