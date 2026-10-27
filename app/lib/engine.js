import fsp from 'node:fs/promises';
import path from 'node:path';
import { run } from './proc.js';
import { ffmpegBin, workingEncoders } from './tools.js';
import { ENCODERS, PROFILES, pickEncoder } from './encoders.js';
import { probe, vmaf, decimateFilter, DEINTERLACE } from './media.js';
import { searchQuality, sampleWindows, spotWindows, nextQAfterMiss, FULL_VERIFY_LIMIT } from './search.js';
import { videoDir, workDir, effectiveType } from './library.js';
import { outputName } from './names.js';

const MAX_PROBES = 6;
// Full encodes allowed per job: the first, plus re-aims when verification misses the target.
const MAX_ATTEMPTS = 4;
const EVEN = 'crop=trunc(iw/2)*2:trunc(ih/2)*2';

// Share of the overall progress bar per phase.
const WEIGHT = { search: 0.35, encode: 0.45, verify: 0.2 };

/** Maps every audio track; copies small AAC/Opus/MP3 tracks and re-encodes the rest to AAC. */
export function audioArgs(source) {
  // meta.json written before audioTracks existed only knows the first track.
  const tracks = source.audioTracks ?? (source.acodec ? [{ codec: source.acodec, bitrate: source.abitrate, channels: 2 }] : []);
  if (!tracks.length) return ['-an'];
  return tracks.flatMap((t, i) => {
    const copy = ['aac', 'opus', 'mp3'].includes(t.codec) && t.bitrate && t.bitrate <= 192000;
    return ['-map', `0:a:${i}`, ...(copy ? [`-c:a:${i}`, 'copy'] : [`-c:a:${i}`, 'aac', `-b:a:${i}`, t.channels > 2 ? '256k' : '128k'])];
  });
}

/**
 * Runs one compression job end to end (DESIGN.md "Pipeline per job").
 * `report({ phase, label, progress })` receives overall progress 0..1.
 * Resolves with { efficient: true } or the output record stored in meta.json.
 */
export async function compress({ meta, profile, target, max, signal, report }) {
  const started = Date.now();
  const source = meta.source;
  const screen = effectiveType(meta) === 'screen';
  const encName = pickEncoder(profile, max, workingEncoders());
  const enc = ENCODERS[encName];
  const src = path.join(videoDir(meta.id), source.file);
  const work = workDir(meta.id);
  await fsp.rm(work, { recursive: true, force: true });
  await fsp.mkdir(work, { recursive: true });

  const deint = source.interlaced ? `${DEINTERLACE},` : '';
  const vf = `${deint}${screen ? `${EVEN},${decimateFilter(source.fps)}` : EVEN}`;
  const videoArgs = (q) => ['-vf', vf, ...(screen ? ['-fps_mode', 'vfr'] : []), ...enc.args(q, { max, screen })];
  const ff = (args, opts = {}) => run(ffmpegBin(), ['-hide_banner', '-nostdin', '-y', ...args], { signal, ...opts });
  const timeOf = (p) => Number(p.out_time_us || p.out_time_ms || 0) / 1e6;

  // --- Search ------------------------------------------------------------------------------
  const windows = sampleWindows(source.duration);
  const sampleSeconds = windows.reduce((s, w) => s + w.t, 0);
  const evaluate = async (q, probeIndex) => {
    const scores = [];
    let doneSeconds = 0;
    const tick = (stepSeconds, half) => {
      const within = (doneSeconds * 2 + half * stepSeconds) / (sampleSeconds * 2);
      report({ phase: 'search', label: `Finding the smallest size · try ${probeIndex + 1} of up to ${MAX_PROBES}`,
        progress: WEIGHT.search * Math.min(1, (probeIndex + Math.min(1, within)) / MAX_PROBES) });
    };
    for (const [i, w] of windows.entries()) {
      const out = path.join(work, `probe-${q}-${i}.mp4`);
      await ff(['-ss', String(w.ss), '-t', String(w.t), '-i', src, '-map', '0:v:0', '-an', '-sn', ...videoArgs(q), out], {
        progress: true, onProgress: (p) => tick(Math.min(w.t, timeOf(p)), 0.4),
      });
      scores.push(await vmaf({ src, dist: out, fpsExpr: source.fpsExpr, width: source.width, height: source.height, deinterlace: source.interlaced, window: w, signal,
        onProgress: (p) => tick(w.t * 0.4 + 0.6 * Math.min(w.t, timeOf(p)), 1) }));
      doneSeconds += w.t;
      await fsp.rm(out, { force: true });
    }
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  };
  const [lo, hi] = enc.range;
  // The start guess is tuned for VMAF 95; each VMAF point is roughly one encoder step.
  const start = enc.start + Math.round((95 - target) * enc.step);
  const found = await searchQuality({ lo, hi, target, start, maxProbes: MAX_PROBES, evaluate });

  // --- Encode + verify (re-aim from the measured score until the target is met) -------------
  const out = path.join(work, 'output.mp4');
  const encodeAt = async (q, attempt) => {
    await ff(['-i', src, '-map', '0:v:0', '-sn', ...videoArgs(q), ...audioArgs(source),
      '-map_metadata', '0', '-movflags', '+faststart', out], {
      progress: true,
      onProgress: (p) => report({ phase: 'encode', label: attempt > 1 ? `Re-encoding at higher quality · attempt ${attempt} of up to ${MAX_ATTEMPTS}` : 'Encoding',
        progress: WEIGHT.search + WEIGHT.encode * Math.min(1, timeOf(p) / source.duration) }),
    });
  };
  const verify = async () => {
    const base = WEIGHT.search + WEIGHT.encode;
    if (source.duration < FULL_VERIFY_LIMIT) {
      return vmaf({ src, dist: out, fpsExpr: source.fpsExpr, width: source.width, height: source.height, deinterlace: source.interlaced, signal,
        onProgress: (p) => report({ phase: 'verify', label: 'Checking quality (every frame)',
          progress: base + WEIGHT.verify * Math.min(1, timeOf(p) / source.duration) }) });
    }
    const spots = spotWindows(source.duration);
    const outInfo = await probe(out);
    const scores = [];
    for (const [i, w] of spots.entries()) {
      scores.push(await vmaf({ src, dist: out, fpsExpr: source.fpsExpr, width: source.width, height: source.height, deinterlace: source.interlaced, window: w, seekDist: true,
        srcStart: source.startTime, distStart: outInfo.startTime, signal }));
      report({ phase: 'verify', label: `Checking quality (spot-check ${i + 1} of ${spots.length})`,
        progress: base + WEIGHT.verify * ((i + 1) / spots.length) });
    }
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  };

  let q = found.q;
  await encodeAt(q, 1);
  let score = await verify();
  let attempts = 1;
  while (score < target && attempts < MAX_ATTEMPTS) {
    const next = nextQAfterMiss({ q, score, target, probes: found.probes, lo, step: enc.step });
    if (next === null) break;
    q = next;
    attempts += 1;
    await encodeAt(q, attempts);
    score = await verify();
  }

  const size = (await fsp.stat(out)).size;
  if (size >= source.size) {
    await fsp.rm(work, { recursive: true, force: true });
    return { efficient: true, size, vmaf: score };
  }

  const record = {
    file: outputName({ profile, codec: PROFILES[profile].codec, max, target }),
    profile,
    codec: PROFILES[profile].codec,
    encoder: encName,
    max: Boolean(max),
    target,
    q,
    vmaf: Math.round(score * 100) / 100,
    vmafMethod: source.duration < FULL_VERIFY_LIMIT ? 'full' : 'spot-check',
    // False only when even the best quality the encoder allows stayed under the target.
    metTarget: score >= target,
    searchProbes: found.probes,
    attempts,
    size,
    deduped: screen,
    encodeSeconds: Math.round((Date.now() - started) / 1000),
    createdAt: new Date().toISOString(),
  };
  const outputsDir = path.join(videoDir(meta.id), 'outputs');
  await fsp.mkdir(outputsDir, { recursive: true });
  await fsp.rename(out, path.join(outputsDir, record.file));
  await fsp.rm(work, { recursive: true, force: true });
  return record;
}
