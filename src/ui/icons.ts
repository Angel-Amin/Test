import type { Res } from '../game/types';

const svg = (body: string, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const RES_ICON: Record<Res, string> = {
  food: svg('<path d="M12 21V8"/><path d="M12 12c-3 0-5-2-5-5 3 0 5 2 5 5zM12 12c3 0 5-2 5-5-3 0-5 2-5 5zM12 17c-3 0-5-2-5-5 3 0 5 2 5 5zM12 17c3 0 5-2 5-5-3 0-5 2-5 5z"/>'),
  water: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  fuel: svg('<path d="M5 21V6l3-3h7v18z"/><path d="M15 9h2l2 2v7a2 2 0 0 1-4 0"/><path d="M8 9h4"/>'),
  ammo: svg('<path d="M7 21V10c0-3 1.5-6 2.5-7 1 1 2.5 4 2.5 7v11z"/><path d="M14 21V12c0-2.5 1-4.5 2-5.5 1 1 2 3 2 5.5v9z"/>'),
  meds: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>'),
  parts: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
};

export const ICON = {
  hq: svg('<path d="M4 21V4l8 3 8-3v17"/><path d="M4 12l8 3 8-3"/>'),
  map: svg('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  ops: svg('<path d="M3 17h2l2-6h8l2 6h4"/><circle cx="8" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M9 11V7h5l1 4"/>'),
  base: svg('<path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M10 21v-6h4v6"/>'),
  log: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M9 10h7M9 14h7M9 18h4"/>'),
  soldier: svg('<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/><path d="M8 5h8"/>'),
  civ: svg('<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>'),
  truck: svg('<path d="M2 16V6h11v10M13 9h5l3 4v3h-8"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
  alert: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
};
