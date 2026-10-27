// Encoder definitions (docs/adr/0002). `q` is the encoder's quality knob: higher = smaller file.
// `range` bounds the quality search, `start` is its first try at VMAF 95 (measured on an
// RTX 4050 laptop), `step` is the "one step better" used after a failed verify.
// QSV and AMF settings are best effort: they were not tested on real hardware (DESIGN.md).

const nvencCommon = ['-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-b:v', '0',
  '-spatial-aq', '1', '-temporal-aq', '1', '-rc-lookahead', '32'];

export const ENCODERS = {
  av1_nvenc: {
    codec: 'av1', vendor: 'NVIDIA', hardware: true, range: [20, 63], start: 39, step: 2,
    args: (q) => ['-c:v', 'av1_nvenc', ...nvencCommon, '-cq', String(q), '-pix_fmt', 'p010le'],
  },
  av1_qsv: {
    codec: 'av1', vendor: 'Intel', hardware: true, range: [20, 50], start: 30, step: 2,
    args: (q) => ['-c:v', 'av1_qsv', '-preset', 'slower', '-global_quality', String(q), '-pix_fmt', 'p010le'],
  },
  av1_amf: {
    codec: 'av1', vendor: 'AMD', hardware: true, range: [60, 200], start: 120, step: 8,
    args: (q) => ['-c:v', 'av1_amf', '-quality', 'quality', '-rc', 'cqp',
      '-qp_i', String(q), '-qp_p', String(q), '-pix_fmt', 'p010le'],
  },
  libsvtav1: {
    codec: 'av1', vendor: 'CPU', hardware: false, range: [20, 63], start: 36, step: 2,
    args: (q, { max, screen } = {}) => ['-c:v', 'libsvtav1', '-preset', max ? '4' : '6', '-crf', String(q),
      '-svtav1-params', screen ? 'tune=0:scm=1' : 'tune=0', '-pix_fmt', 'yuv420p10le'],
  },
  h264_nvenc: {
    codec: 'h264', vendor: 'NVIDIA', hardware: true, range: [16, 51], start: 26, step: 2,
    args: (q) => ['-c:v', 'h264_nvenc', ...nvencCommon, '-cq', String(q), '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
  },
  h264_qsv: {
    codec: 'h264', vendor: 'Intel', hardware: true, range: [16, 51], start: 26, step: 2,
    args: (q) => ['-c:v', 'h264_qsv', '-preset', 'slower', '-global_quality', String(q), '-profile:v', 'high', '-pix_fmt', 'nv12'],
  },
  h264_amf: {
    codec: 'h264', vendor: 'AMD', hardware: true, range: [16, 51], start: 26, step: 2,
    args: (q) => ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp',
      '-qp_i', String(q), '-qp_p', String(q), '-qp_b', String(q), '-pix_fmt', 'yuv420p'],
  },
  libx264: {
    codec: 'h264', vendor: 'CPU', hardware: false, range: [14, 51], start: 23, step: 2,
    args: (q, { max } = {}) => ['-c:v', 'libx264', '-preset', max ? 'slow' : 'medium', '-crf', String(q),
      '-profile:v', 'high', '-pix_fmt', 'yuv420p'],
  },
};

export const PROFILES = {
  archive: { label: 'Archive', codec: 'av1', defaultTarget: 95, chain: ['av1_nvenc', 'av1_qsv', 'av1_amf', 'libsvtav1'], cpu: 'libsvtav1' },
  share: { label: 'Share', codec: 'h264', defaultTarget: 93, chain: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'], cpu: 'libx264' },
};

export const TARGETS = [90, 93, 95, 97];

/** Picks the encoder for a job given which encoders passed the detection test. */
export function pickEncoder(profile, max, working) {
  const p = PROFILES[profile];
  if (!p) throw new Error(`Unknown profile ${profile}`);
  if (max) return p.cpu;
  return p.chain.find((name) => working[name]) || p.cpu;
}
