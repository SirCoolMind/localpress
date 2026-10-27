export function bytes(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export const saving = (before, after) => (before > 0 ? Math.max(0, 1 - after / before) : 0);
export const pct = (fraction) => `−${Math.round(fraction * 100)}%`;
export const times = (before, after) => (after > 0 ? before / after : 0);

export function ratioText(before, after) {
  const x = times(before, after);
  return x >= 10 ? `${Math.round(x)}× smaller` : `${x.toFixed(1)}× smaller`;
}

export function duration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function eta(sec) {
  if (!Number.isFinite(sec) || sec === null) return '';
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s left`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`;
}

export function timecode(t, fps) {
  if (!Number.isFinite(t)) t = 0;
  const f = Math.floor((t % 1) * (fps || 30));
  const s = Math.floor(t);
  return `${duration(s)}:${String(f).padStart(2, '0')}`;
}

export const PROFILE_NAMES = { archive: 'Archive', share: 'Share' };
export const CODEC_NAMES = { av1: 'AV1', h264: 'H.264' };

export function outputTitle(o) {
  const codec = o.codec || (o.profile === 'archive' ? 'av1' : 'h264');
  return `${PROFILE_NAMES[o.profile] || o.profile} · ${CODEC_NAMES[codec] || codec}${o.max ? ' · max' : ''}`;
}

export function encoderLabel(name) {
  return {
    av1_nvenc: 'NVIDIA AV1', av1_qsv: 'Intel AV1', av1_amf: 'AMD AV1', libsvtav1: 'CPU AV1 (SVT)',
    h264_nvenc: 'NVIDIA H.264', h264_qsv: 'Intel H.264', h264_amf: 'AMD H.264', libx264: 'CPU H.264 (x264)',
  }[name] || name;
}
