// Set de iconos portado de High Class Karaoke Redesign/kiosk/app.js (paths ya
// en estilo Phosphor/outline) — evita agregar una dependencia npm para esto.
const PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm10 17-5.6-5.6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  play: 'M6 4l14 8-14 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M3 12a9 9 0 0 1 15.3-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.3 6.4L3 16M3 21v-5h5',
  trash: 'M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13',
  chevL: 'M14 5l-7 7 7 7',
  chevR: 'M10 5l7 7-7 7',
  volume: 'M4 9v6h4l5 4V5L8 9z M17 8a5 5 0 0 1 0 8',
  micOff: 'M4 4l16 16 M9 9v3a3 3 0 0 0 4.6 2.5 M15 9V6a3 3 0 0 0-5.9-.8 M7 12v0a5 5 0 0 0 8.5 3.6 M12 17v3 M9 20h6',
  sync: 'M4 12a8 8 0 0 1 14-5.2M20 12a8 8 0 0 1-14 5.2 M18 4v4h-4 M6 20v-4h4',
  expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  collapse: 'M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5',
  x: 'M5 5l14 14M19 5 5 19',
  up: 'M12 19V5 M6 11l6-6 6 6',
  down: 'M12 5v14 M6 13l6 6 6-6',
  star: 'M12 3l2.7 5.9 6.3.6-4.8 4.3 1.4 6.2L12 16.9 6.4 20l1.4-6.2L3 9.5l6.3-.6z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6',
  playlist: 'M4 6h11M4 12h11M4 18h6 M17 14v6 M14.5 17.5 17 20l3-3',
  slider: 'M4 8h10M18 8h2M4 16h4M12 16h8 M15 5v6 M9 13v6',
  upload: 'M12 19V6 M6 11l6-6 6 6 M4 21h16',
  wand: 'M5 19 17 7 M14 4l1.4 2.6L18 8l-2.6 1.4L14 12l-1.4-2.6L10 8l2.6-1.4z M6 12l.8 1.5L8.3 14l-1.5.8L6 16.3l-.8-1.5L3.7 14l1.5-.8z',
  film: 'M3 5h18v14H3z M7 5v14M17 5v14M3 12h18M3 9h4M3 15h4M17 9h4M17 15h4',
  folder: 'M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  gear: 'M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M6 6l1.7 1.7M16.3 16.3 18 18M18 6l-1.7 1.7M7.7 16.3 6 18',
  check: 'M5 12.5 9.5 17 19 7',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4z M12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18, w = 1.8 }: { name: IconName; size?: number; w?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  )
}
