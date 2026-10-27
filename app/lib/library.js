import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { paths, VIDEO_EXTENSIONS, DISK_MARGIN } from './config.js';
import { cleanName, uniqueName, isPlainSegment } from './names.js';
import { HttpError } from './http.js';
import { broadcast } from './events.js';
import { probe, thumbnail, detectContentType, makePreview } from './media.js';
import { toolsReady, workingEncoders } from './tools.js';

const videos = new Map(); // id -> meta
const busy = new Set(); // ids being imported

export const videoDir = (id) => path.join(paths.videos, id);
export const workDir = (id) => path.join(videoDir(id), '.work');

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

export async function loadLibrary() {
  await fsp.mkdir(paths.videos, { recursive: true });
  videos.clear();
  for (const entry of await fsp.readdir(paths.videos, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(paths.videos, entry.name, 'meta.json'), 'utf8'));
      meta.id = entry.name;
      // Outputs deleted in Explorer disappear from the list instead of breaking it.
      meta.outputs = (meta.outputs || []).filter((o) => fs.existsSync(path.join(paths.videos, entry.name, 'outputs', o.file)));
      if (meta.source && !meta.sourceRemoved && !fs.existsSync(path.join(paths.videos, entry.name, meta.source.file))) {
        meta.sourceRemoved = true;
      }
      videos.set(entry.name, meta);
    } catch {
      // A folder without a readable meta.json is not a LocalPress video; leave it alone.
    }
  }
}

export function getVideo(id) {
  const meta = videos.get(id);
  if (!meta) throw new HttpError(404, 'Video not found');
  return meta;
}

export const hasVideo = (id) => videos.has(id);

export async function saveVideo(meta) {
  videos.set(meta.id, meta);
  await writeJsonAtomic(path.join(videoDir(meta.id), 'meta.json'), meta);
  await emitLibrary();
}

async function dirSize(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

export async function diskInfo() {
  await fsp.mkdir(paths.videos, { recursive: true });
  const s = await fsp.statfs(paths.videos);
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize, library: await dirSize(paths.videos) };
}

export function listVideos() {
  return [...videos.values()].sort((a, b) => (b.importedAt || '').localeCompare(a.importedAt || ''));
}

export async function emitLibrary() {
  broadcast('library', { videos: listVideos(), disk: await diskInfo() });
}

/** Streams an upload into videos/<clean-name>/source.<ext> and analyses it. */
export async function importUpload(req, fileName, size) {
  if (!toolsReady()) throw new HttpError(409, 'Install the tools first (Tools panel).');
  const ext = path.extname(fileName || '').toLowerCase();
  if (!VIDEO_EXTENSIONS.has(ext)) throw new HttpError(415, `${ext || 'This file type'} is not a supported video file.`);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(411, 'Missing file size.');

  const { free } = await diskInfo();
  const need = size * 2 + DISK_MARGIN;
  if (free < need) {
    const gb = (n) => (n / 1024 ** 3).toFixed(1);
    throw new HttpError(507, `Not enough disk space: this video needs about ${gb(need)} GB free (copy + output), only ${gb(free)} GB available.`);
  }

  const taken = new Set([...(await fsp.readdir(paths.videos)), ...busy]);
  const id = uniqueName(cleanName(fileName), taken);
  busy.add(id);
  const dir = videoDir(id);
  const sourceFile = `source${ext}`;
  try {
    await fsp.mkdir(dir, { recursive: true });
    let received = 0;
    req.on('data', (c) => { received += c.length; });
    await pipeline(req, fs.createWriteStream(path.join(dir, sourceFile)));
    if (received !== size) throw new HttpError(400, 'Upload was interrupted.');

    const src = path.join(dir, sourceFile);
    let source;
    try {
      source = await probe(src);
    } catch {
      throw new HttpError(415, 'This file looks damaged or incomplete. If it is still downloading or copying, try again when it has finished.');
    }
    if (!source) throw new HttpError(415, 'No video stream found in this file.');
    await thumbnail(src, path.join(dir, 'thumb.jpg'), source.duration).catch(() => {});
    const contentType = await detectContentType(src, source).catch(() => ({ detected: 'camera', dupRatio: 0, override: null }));

    const meta = {
      id,
      originalName: path.basename(fileName),
      importedAt: new Date().toISOString(),
      sourceRemoved: false,
      source: { file: sourceFile, ...source },
      contentType,
      preview: null,
      outputs: [],
    };
    await saveVideo(meta);
    return meta;
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  } finally {
    busy.delete(id);
  }
}

export async function setContentType(id, value) {
  const meta = getVideo(id);
  if (value !== null && value !== 'screen' && value !== 'camera') throw new HttpError(400, 'contentType must be screen, camera or null');
  meta.contentType.override = value === meta.contentType.detected ? null : value;
  await saveVideo(meta);
  return meta;
}

export const effectiveType = (meta) => meta.contentType.override || meta.contentType.detected;

export async function removeSource(id) {
  const meta = getVideo(id);
  await fsp.rm(path.join(videoDir(id), meta.source.file), { force: true });
  await fsp.rm(path.join(videoDir(id), '.preview'), { recursive: true, force: true });
  meta.sourceRemoved = true;
  meta.preview = null;
  await saveVideo(meta);
  return meta;
}

export async function deleteVideo(id) {
  getVideo(id);
  await fsp.rm(videoDir(id), { recursive: true, force: true });
  videos.delete(id);
  await emitLibrary();
}

export async function deleteOutput(id, file) {
  const meta = getVideo(id);
  if (!isPlainSegment(file) || !meta.outputs.some((o) => o.file === file)) throw new HttpError(404, 'Output not found');
  await fsp.rm(path.join(videoDir(id), 'outputs', file), { force: true });
  meta.outputs = meta.outputs.filter((o) => o.file !== file);
  await saveVideo(meta);
  return meta;
}

export async function ensurePreview(id, mode) {
  const meta = getVideo(id);
  if (meta.sourceRemoved) throw new HttpError(409, 'The source copy was removed.');
  if (mode !== 'remux' && mode !== 'proxy') throw new HttpError(400, 'mode must be remux or proxy');
  const dir = path.join(videoDir(id), '.preview');
  await fsp.mkdir(dir, { recursive: true });
  const file = `${mode}.mp4`;
  const enc = workingEncoders();
  await makePreview(path.join(videoDir(id), meta.source.file), path.join(dir, file), mode, enc.h264_nvenc ? 'h264_nvenc' : 'libx264');
  meta.preview = { file, mode };
  await saveVideo(meta);
  return meta;
}
