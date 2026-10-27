// One authored set: 24px grid, 1.5px stroke (set in CSS), round caps.
const P = {
  upload: '<path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 14.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5"/>',
  play: '<path d="M7.5 5.2v13.6a.7.7 0 0 0 1.05.6l11-6.8a.7.7 0 0 0 0-1.2l-11-6.8a.7.7 0 0 0-1.05.6Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  compare: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 3v18"/><path d="M7 12h2M15 12h2"/>',
  download: '<path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5"/><path d="M4 19.5h16"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6"/><path d="M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7"/><path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M7 7l10 10M17 7 7 17"/>',
  alert: '<path d="M12 8.5v4.5M12 16.5v.01"/><path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  queue: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="M17 15.5v5l4-2.5Z"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5.3 5.3L4 17v3h3l5.4-5.4a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4Z"/>',
  retry: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4.5v4h4"/>',
  screen: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  camera: '<path d="M3.5 8.5a2 2 0 0 1 2-2h1.8l1.4-2h6.6l1.4 2h1.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8.5v5M8.5 11h5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  stepBack: '<path d="M17 6.5v11L9 12Z"/><path d="M6.5 6v12"/>',
  stepFwd: '<path d="M7 6.5v11l8-5.5Z"/><path d="M17.5 6v12"/>',
  grip: '<path d="M9 7l-4 5 4 5M15 7l4 5-4 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  power: '<path d="M12 3.5v8"/><path d="M6.8 6.6a7.5 7.5 0 1 0 10.4 0"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
  scissors: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5 20 17M8 15.5 20 7"/>',
};

export function icon(name, cls) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${P[name] || ''}</svg>`;
  return span.firstChild;
}
