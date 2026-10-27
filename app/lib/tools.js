import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { paths, FFMPEG_PIN } from './config.js';
import { run } from './proc.js';
import { ENCODERS } from './encoders.js';
import { broadcast } from './events.js';

const ffmpegDir = () => path.join(paths.tools, 'ffmpeg');
export const ffmpegBin = () => path.join(ffmpegDir(), 'bin', 'ffmpeg.exe');
export const ffprobeBin = () => path.join(ffmpegDir(), 'bin', 'ffprobe.exe');

const REQUIRED_FEATURES = ['libvmaf', 'libsvtav1', 'av1_nvenc'];

const state = {
  node: { version: process.version, inApp: process.execPath.startsWith(paths.app) },
  ffmpeg: { installed: false, version: null, missing: [] },
  encoders: null,
  gpus: [],
  checking: false,
  install: { state: 'idle', received: 0, total: FFMPEG_PIN.size, error: null },
};

export function toolsStatus() {
  return {
    ...state,
    pin: { version: FFMPEG_PIN.version, size: FFMPEG_PIN.size },
    ready: toolsReady(),
    hints: hints(),
  };
}

// Ready only once encoders are known, so no job starts on the CPU by mistake.
export const toolsReady = () => state.ffmpeg.installed && state.ffmpeg.missing.length === 0 && state.encoders !== null;
export const workingEncoders = () => state.encoders || {};

function hints() {
  const out = [];
  const hasNvidia = state.gpus.some((g) => /nvidia/i.test(g));
  if (hasNvidia && state.encoders && !state.encoders.av1_nvenc && !state.encoders.h264_nvenc) {
    out.push({ text: 'Your NVIDIA GPU did not accept a test encode. Updating the NVIDIA driver usually fixes this.', link: 'https://www.nvidia.com/Download/index.aspx' });
  } else if (hasNvidia && state.encoders && !state.encoders.av1_nvenc && state.encoders.h264_nvenc) {
    out.push({ text: 'Your NVIDIA GPU cannot encode AV1 (it needs an RTX 40-series or newer). Archive will use the CPU encoder.' });
  }
  if (state.encoders && !Object.entries(state.encoders).some(([n, ok]) => ok && ENCODERS[n].hardware)) {
    out.push({ text: 'No hardware encoder found. Everything will run on the CPU, which is slower.' });
  }
  return out;
}

const emit = () => broadcast('tools', toolsStatus());

async function detectGpus() {
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command',
      '(Get-CimInstance Win32_VideoController).Name'], { allowFail: true });
    state.gpus = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    state.gpus = [];
  }
}

async function inspectFfmpeg() {
  state.ffmpeg = { installed: false, version: null, missing: [] };
  if (!fs.existsSync(ffmpegBin()) || !fs.existsSync(ffprobeBin())) return;
  try {
    const v = await run(ffmpegBin(), ['-hide_banner', '-version']);
    const enc = await run(ffmpegBin(), ['-hide_banner', '-encoders']);
    const fil = await run(ffmpegBin(), ['-hide_banner', '-filters']);
    const all = enc.stdout + fil.stdout;
    state.ffmpeg = {
      installed: true,
      version: (/ffmpeg version (\S+)/.exec(v.stdout) || [])[1] || 'unknown',
      missing: REQUIRED_FEATURES.filter((f) => !new RegExp(`\\b${f}\\b`).test(all)),
    };
  } catch (err) {
    state.ffmpeg = { installed: false, version: null, missing: [], error: err.message };
  }
}

/** A tiny real encode per encoder: the only reliable test of drivers + hardware. */
async function detectEncoders() {
  if (!state.ffmpeg.installed) {
    state.encoders = null;
    return;
  }
  const result = {};
  for (const [name, enc] of Object.entries(ENCODERS)) {
    const q = Math.round((enc.range[0] + enc.range[1]) / 2);
    try {
      await run(ffmpegBin(), ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=0.3',
        ...enc.args(q, {}), '-f', 'null', '-']);
      result[name] = true;
    } catch {
      result[name] = false;
    }
  }
  state.encoders = result;
}

export async function recheck() {
  if (state.checking) return toolsStatus();
  state.checking = true;
  emit();
  try {
    if (!state.gpus.length) await detectGpus();
    await inspectFfmpeg();
    await detectEncoders();
  } finally {
    state.checking = false;
    emit();
  }
  return toolsStatus();
}

function download(url, dest, onBytes, redirects = 0) {
  if (url.startsWith('file:')) {
    // Test-only path (LOCALPRESS_FFMPEG_URL): copy a local zip through the same pipeline.
    return new Promise((resolve, reject) => {
      const src = fs.createReadStream(fileURLToPath(url));
      src.on('data', (c) => onBytes(c.length));
      src.on('error', reject);
      src.pipe(fs.createWriteStream(dest)).on('finish', resolve).on('error', reject);
    });
  }
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LocalPress' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects > 5) return reject(new Error('Too many redirects'));
        return resolve(download(new URL(res.headers.location, url).toString(), dest, onBytes, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      res.on('data', (c) => onBytes(c.length));
      res.pipe(fs.createWriteStream(dest)).on('finish', resolve).on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function installRunning() {
  return !['idle', 'error'].includes(state.install.state);
}

export async function installFfmpeg() {
  if (installRunning()) return;
  const work = path.join(paths.tools, '.download');
  const zip = path.join(work, 'ffmpeg.zip.part');
  const set = (patch) => {
    Object.assign(state.install, patch);
    emit();
  };
  try {
    await fsp.rm(work, { recursive: true, force: true });
    await fsp.mkdir(work, { recursive: true });

    set({ state: 'downloading', received: 0, total: FFMPEG_PIN.size, error: null });
    let lastEmit = 0;
    await download(FFMPEG_PIN.url, zip, (n) => {
      state.install.received += n;
      const now = Date.now();
      if (now - lastEmit > 250) {
        lastEmit = now;
        emit();
      }
    });

    set({ state: 'verifying' });
    const got = await sha256(zip);
    if (got !== FFMPEG_PIN.sha256) throw new Error('The download did not match the expected checksum, so it was discarded. Try again.');

    set({ state: 'extracting' });
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const out = path.join(work, 'x');
    await fsp.mkdir(out, { recursive: true });
    await run(tar, ['-xf', zip, '-C', out]);
    await fsp.rm(ffmpegDir(), { recursive: true, force: true });
    await fsp.rename(path.join(out, FFMPEG_PIN.folder), ffmpegDir());
    await fsp.rm(work, { recursive: true, force: true });

    set({ state: 'checking' });
    await recheck();
    set({ state: 'idle' });
  } catch (err) {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    set({ state: 'error', error: err.message });
  }
}

export async function uninstallFfmpeg() {
  await fsp.rm(ffmpegDir(), { recursive: true, force: true });
  state.install = { state: 'idle', received: 0, total: FFMPEG_PIN.size, error: null };
  await recheck();
}
