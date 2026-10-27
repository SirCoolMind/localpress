import path from 'node:path';

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** Turns a dropped file name into a Windows-safe folder name (docs/adr/0003). */
export function cleanName(fileName) {
  let name = path.basename(String(fileName || ''));
  const ext = path.extname(name);
  if (ext) name = name.slice(0, -ext.length);

  name = name
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');

  if (name.length > 80) name = name.slice(0, 80).replace(/[. ]+$/, '');
  if (!name) name = 'video';
  // Windows also reserves "CON.txt" and "NUL .x": the part before the first dot decides.
  const head = name.split('.')[0].trim();
  if (RESERVED.test(head)) name = head === name ? `${name}_` : `_${name}`;
  return name;
}

/** `name`, then `name (2)`, `name (3)`… — compared case-insensitively like NTFS. */
export function uniqueName(base, taken) {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/** `archive-av1_vmaf95_2026-10-26-143215.mp4`, with `-max` for CPU max-squeeze encodes. */
export function outputName({ profile, codec, max, target }, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${profile}-${codec}${max ? '-max' : ''}_vmaf${target}_${stamp}.mp4`;
}

/** True when `name` is a single plain path segment (no traversal, no separators). */
export function isPlainSegment(name) {
  return typeof name === 'string' && name.length > 0 && name === path.basename(name)
    && name !== '.' && name !== '..' && !/[<>:"/\\|?*\u0000-\u001f]/.test(name);
}
