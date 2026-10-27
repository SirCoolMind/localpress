import { h, ic } from './dom.js';

// Last-used "new version" choices: a per-viewer convenience, so browser storage is fine here.
const KEY = 'localpress.newVersion';
const DEFAULTS = { profile: 'archive', target: 95, max: false };

export function loadChoice() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveChoice(choice) {
  try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* storage unavailable */ }
}

export const PROFILE_DEFAULT_TARGET = { archive: 95, share: 93 };

function seg(label, options, value, onPick, cls = '') {
  return h(`div.seg${cls}`, { role: 'group', 'aria-label': label },
    options.map((o) => h('button', {
      type: 'button',
      'aria-pressed': String(o.value === value),
      title: o.title,
      onclick: () => onPick(o.value),
    }, o.icon ? ic(o.icon) : null, o.num ? h('span.num', o.label) : o.label)));
}

/** Profile / quality / speed controls. `compact` renders them in one row for the selection bar. */
export function choiceControls(choice, onChange, { compact = false, targets = [90, 93, 95, 97] } = {}) {
  const set = (patch) => {
    const next = { ...choice, ...patch };
    if (patch.profile && patch.profile !== choice.profile) next.target = PROFILE_DEFAULT_TARGET[patch.profile];
    saveChoice(next);
    onChange(next);
  };
  const profile = seg('Profile', [
    { value: 'archive', label: compact ? 'Archive' : 'Archive · AV1', title: 'Smallest files; plays on PCs, browsers, YouTube and recent phones' },
    { value: 'share', label: compact ? 'Share' : 'Share · H.264', title: 'Plays everywhere, including WhatsApp and older phones' },
  ], choice.profile, (profile) => set({ profile }));
  const target = seg('Quality (VMAF)', targets.map((t) => ({ value: t, label: String(t), num: true })), choice.target, (t) => set({ target: t }), compact ? '' : '');
  const speed = seg('Encoder', [
    { value: false, label: 'GPU', icon: 'chip', title: 'Fast, uses the graphics card' },
    { value: true, label: 'Max squeeze', icon: 'cpu', title: 'Slower, on the CPU, smallest files' },
  ], choice.max, (max) => set({ max }));

  if (compact) return [profile, target, speed];
  return [
    h('div.field', h('span', 'Profile'), profile,
      h('span.hint', choice.profile === 'archive' ? 'AV1. Smallest; plays on PCs, browsers, YouTube and recent phones.' : 'H.264. Plays anywhere, including WhatsApp and older phones.')),
    h('div.field', h('span', 'Looks the same at VMAF'), target,
      h('span.hint', { class: 'num-hint' }, choice.target >= 95 ? 'Most people cannot tell it from the original.' : choice.target === 93 ? 'Visually very close; good for sharing.' : 'Small differences may show on close viewing.')),
    h('div.field', h('span', 'Encoder'), speed,
      h('span.hint', choice.max ? 'Runs on the CPU. Several times slower; your fans will notice.' : 'Runs on the graphics card. Fast and cool.')),
  ];
}
