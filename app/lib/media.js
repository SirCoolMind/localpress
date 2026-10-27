import os from 'node:os';
import { run } from './proc.js';
import { ffmpegBin, ffprobeBin } from './tools.js';

const num = (v) => (v === undefined || v === null || v === 'N/A' || v === '' ? null : Number(v));

function rate(str) {
  if (!str || str === '0/0') return null;
  const [a, b] = str.split('/').map(Number);
  const v = b ? a / b : a;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Probes a file into the flat shape stored in meta.json `source`. */
export async function probe(file) {
  const { stdout } = await run(ffprobeBin(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(stdout);
  const v = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!v) return null;
  const audio = info.streams.filter((s) => s.codec_type === 'audio');
  const a = audio[0];
  const bitrateOf = (s) => num(s.bit_rate) ?? num(s.tags?.BPS) ?? num(s.tags?.['BPS-eng']);

  // Prefer the nominal rate; fall back to the average when the nominal one is a timebase artefact.
  const r = rate(v.r_frame_rate);
  const avg = rate(v.avg_frame_rate);
  const useR = r && r <= 120;
  const fps = useR ? r : avg || r || 30;
  const fpsExpr = useR ? v.r_frame_rate : (v.avg_frame_rate && avg ? v.avg_frame_rate : String(Math.round(fps)));

  let rotation = 0;
  for (const sd of v.side_data_list || []) if (sd.rotation !== undefined) rotation = Number(sd.rotation);
  const swap = Math.abs(rotation) % 180 === 90;

  const abitrate = a ? bitrateOf(a) : null;
  return {
    size: num(info.format.size),
    duration: num(info.format.duration) ?? num(v.duration) ?? 0,
    startTime: num(info.format.start_time) ?? 0,
    bitrate: num(info.format.bit_rate),
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    fps: Math.round(fps * 1000) / 1000,
    fpsExpr,
    vcodec: v.codec_name,
    pixFmt: v.pix_fmt,
    hdr: ['smpte2084', 'arib-std-b67'].includes(v.color_transfer),
    // TV captures and camcorders: fields would show as combing once stored as progressive frames.
    interlaced: ['tt', 'bb', 'tb', 'bt'].includes(v.field_order),
    acodec: a ? a.codec_name : null,
    abitrate,
    // Every track is kept: OBS and Game Bar often put the microphone on a second track.
    audioTracks: audio.map((s) => ({ codec: s.codec_name, bitrate: bitrateOf(s), channels: s.channels || 2 })),
    container: info.format.format_name,
  };
}

export async function thumbnail(src, out, duration) {
  const at = Math.max(0, Math.min(duration * 0.1, duration - 0.5));
  await run(ffmpegBin(), ['-hide_banner', '-v', 'error', '-y', '-ss', String(at), '-i', src,
    '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', out]);
}

/** Conservative duplicate-frame dropper; keeps at least one frame per second. */
export const decimateFilter = (fps) => `mpdecimate=hi=128:lo=64:frac=0.1:max=${Math.max(1, Math.round(fps))}`;

// Detection counts only (near-)exact repeats. The looser dropper above also matches consecutive
// film frames in slow scenes, which made 120 fps footage look like a screen recording
// (and dropping those frames cost ~3.5 VMAF at equal quantiser).
const detectFilter = (fps) => `mpdecimate=hi=32:lo=16:frac=0.02:max=${Math.max(1, Math.round(fps))}`;

/**
 * Screen vs camera: fraction of near-identical frames in a 20 s sample from the middle.
 * Screen recordings sit mostly still; camera footage almost never repeats a frame exactly.
 */
export async function detectContentType(src, meta) {
  const len = Math.min(20, meta.duration);
  const start = Math.max(0, meta.duration / 2 - len / 2);
  let frames = 0;
  await run(ffmpegBin(), ['-hide_banner', '-v', 'error', '-ss', String(start), '-t', String(len), '-i', src,
    '-an', '-sn', '-vf', detectFilter(meta.fps), '-fps_mode', 'vfr', '-f', 'null', '-'], {
    progress: true,
    onProgress: (p) => { frames = Number(p.frame) || frames; },
  });
  const expected = Math.max(1, Math.round(len * meta.fps));
  const dupRatio = Math.max(0, Math.min(1, 1 - frames / expected));
  return { detected: dupRatio >= 0.3 ? 'screen' : 'camera', dupRatio: Math.round(dupRatio * 1000) / 1000, override: null };
}

const vmafThreads = () => Math.max(2, Math.min(16, os.cpus().length));
const EVEN = 'crop=trunc(iw/2)*2:trunc(ih/2)*2';
/** One output frame per input frame, so the frame rate and timing stay as they were. */
export const DEINTERLACE = 'bwdif=mode=send_frame:deint=interlaced';

/** `,scale=…` that brings the short side down to 1080, or '' when the video is 1080p or smaller. */
export function vmafScale(width, height) {
  const short = Math.min(width || 0, height || 0);
  if (!short || short <= 1080) return '';
  const f = 1080 / short;
  return `,scale=${Math.round((width * f) / 2) * 2}:${Math.round((height * f) / 2) * 2}:flags=bicubic`;
}

/**
 * VMAF of `dist` against `src`.
 * - window: { ss, t } compares that span of the source with the *start* of dist (sample encodes),
 *   or, with `seekDist: true`, the same span of both files (spot-checks of a full encode).
 * - fpsExpr: both files are put on the source frame grid, so a duplicate-dropped output or a
 *   variable-frame-rate source still pairs frame for frame.
 * - deinterlace: the source is deinterlaced the same way the encode was, so only compression
 *   loss is measured.
 * - width/height (display size): anything larger than 1080p is scored at 1080p, the viewing
 *   condition the default VMAF model is trained for — and 2–4× faster at 1440p/4K.
 */
export async function vmaf({ src, dist, fpsExpr, width, height, deinterlace = false, window, seekDist = false, srcStart = 0, distStart = 0, signal, onProgress }) {
  const args = ['-hide_banner', '-nostdin'];
  let distChain;
  let refChain;
  if (window && seekDist) {
    // Keep real timestamps so a duplicate-dropped output still has the frame that was showing at
    // `ss`; pre-roll 1.5 s (mpdecimate keeps at least one frame per second), then trim exactly.
    const pre = Math.max(0, window.ss - 1.5);
    // Input -ss is relative to each file's own start; with -copyts the frames keep absolute
    // timestamps, which is why the trims below add each file's start time.
    args.push('-copyts', '-ss', String(pre), '-i', dist, '-ss', String(pre), '-i', src);
    distChain = `fps=${fpsExpr},trim=start=${window.ss + distStart}:duration=${window.t},setpts=PTS-STARTPTS`;
    refChain = `${deinterlace ? `${DEINTERLACE},` : ''}${EVEN},fps=${fpsExpr},trim=start=${window.ss + srcStart}:duration=${window.t},setpts=PTS-STARTPTS`;
  } else {
    args.push('-i', dist);
    if (window) args.push('-ss', String(window.ss), '-t', String(window.t));
    args.push('-i', src);
    // Both sides go on the same frame grid: a deduped output has gaps, and a variable-frame-rate
    // source (Game Bar, OBS, phones) has uneven timestamps; pairing by index would misalign either.
    distChain = `fps=${fpsExpr},setpts=PTS-STARTPTS`;
    refChain = `${deinterlace ? `${DEINTERLACE},` : ''}${EVEN},fps=${fpsExpr},setpts=PTS-STARTPTS`;
  }
  const fit = vmafScale(width, height);
  const graph = `[0:v]${distChain}${fit},format=yuv420p[d];[1:v]${refChain}${fit},format=yuv420p[r];[d][r]libvmaf=n_threads=${vmafThreads()}`;
  const { stderr } = await run(ffmpegBin(), [...args, '-lavfi', graph, '-an', '-sn', '-f', 'null', '-'], {
    signal, progress: true, onProgress,
  });
  const m = /VMAF score: ([\d.]+)/.exec(stderr);
  if (!m) throw new Error('VMAF did not report a score');
  return Number(m[1]);
}

/** Browser-playable copy for viewing only: remux first, H.264 proxy if that is not enough. */
export async function makePreview(src, out, mode, h264Encoder) {
  const audio = ['-c:a', 'aac', '-b:a', '160k'];
  const common = ['-hide_banner', '-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-sn'];
  if (mode === 'remux') {
    await run(ffmpegBin(), [...common, '-c:v', 'copy', ...audio, '-movflags', '+faststart', out]);
  } else {
    const v = h264Encoder === 'h264_nvenc'
      ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-b:v', '0']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
    await run(ffmpegBin(), [...common, '-vf', EVEN, ...v, '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', out]);
  }
}
