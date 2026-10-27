import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from './config.js';
import { broadcast } from './events.js';
import { HttpError } from './http.js';
import { PROFILES, TARGETS } from './encoders.js';
import { compress } from './engine.js';
import { toolsReady } from './tools.js';
import { getVideo, hasVideo, saveVideo, workDir } from './library.js';

const FINISHED_KEPT = 50;
const queueFile = () => path.join(paths.videos, 'queue.json');

let queue = { paused: false, jobs: [] };
let current = null; // { job, controller }

export const queueState = () => ({ paused: queue.paused, jobs: queue.jobs, running: current?.job.id || null });
export const isRunningFor = (videoId) => current?.job.videoId === videoId;

async function save() {
  const finished = queue.jobs.filter((j) => !['queued', 'running'].includes(j.status));
  if (finished.length > FINISHED_KEPT) {
    const drop = new Set(finished.slice(0, finished.length - FINISHED_KEPT).map((j) => j.id));
    queue.jobs = queue.jobs.filter((j) => !drop.has(j.id));
  }
  await fsp.mkdir(paths.videos, { recursive: true });
  const tmp = `${queueFile()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(queue, null, 2));
  await fsp.rename(tmp, queueFile());
}

const emit = () => broadcast('queue', queueState());

/** Startup recovery (docs/adr/0003): running → interrupted, waiting jobs stay paused. */
export async function loadQueue() {
  try {
    queue = JSON.parse(await fsp.readFile(queueFile(), 'utf8'));
  } catch {
    queue = { paused: false, jobs: [] };
  }
  for (const job of queue.jobs) {
    if (job.status === 'running') {
      job.status = 'interrupted';
      job.label = 'Interrupted — the app closed during this job';
      job.progress = 0;
    }
  }
  queue.jobs = queue.jobs.filter((j) => hasVideo(j.videoId));
  if (queue.jobs.some((j) => j.status === 'queued')) queue.paused = true;
  // Half-written files from an interrupted job.
  for (const entry of await fsp.readdir(paths.videos, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) await fsp.rm(workDir(entry.name), { recursive: true, force: true });
  }
  await save();
}

export async function addJobs({ videoIds, profile, target, max }) {
  if (!toolsReady()) throw new HttpError(409, 'Install the tools first (Tools panel).');
  if (!PROFILES[profile]) throw new HttpError(400, 'Unknown profile');
  if (!TARGETS.includes(Number(target))) throw new HttpError(400, `Target must be one of ${TARGETS.join(', ')}`);
  if (!Array.isArray(videoIds) || !videoIds.length) throw new HttpError(400, 'No videos selected');
  const added = [];
  for (const id of videoIds) {
    const meta = getVideo(id);
    if (meta.sourceRemoved) throw new HttpError(409, `"${meta.id}" has no source copy any more.`);
    const job = {
      id: crypto.randomUUID(),
      videoId: id,
      profile,
      target: Number(target),
      max: Boolean(max),
      status: 'queued',
      phase: null,
      label: 'Waiting',
      progress: 0,
      eta: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
    };
    queue.jobs.push(job);
    added.push(job);
  }
  await save();
  emit();
  kick();
  return added;
}

function findJob(jobId) {
  const job = queue.jobs.find((j) => j.id === jobId);
  if (!job) throw new HttpError(404, 'Job not found');
  return job;
}

export async function cancelJob(jobId) {
  const job = findJob(jobId);
  if (current?.job.id === jobId) {
    current.controller.abort();
    return;
  }
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.label = 'Cancelled';
    await save();
    emit();
  }
}

export async function retryJob(jobId) {
  const job = findJob(jobId);
  if (!['failed', 'cancelled', 'interrupted'].includes(job.status)) throw new HttpError(409, 'Only stopped jobs can be retried');
  if (getVideo(job.videoId).sourceRemoved) throw new HttpError(409, 'The source copy was removed.');
  Object.assign(job, { status: 'queued', label: 'Waiting', progress: 0, eta: null, error: null, phase: null });
  // Retrying is an explicit "go": it does not wait for Resume.
  queue.paused = false;
  await save();
  emit();
  kick();
}

export async function removeJob(jobId) {
  const job = findJob(jobId);
  if (job.status === 'running') throw new HttpError(409, 'Cancel the job first');
  queue.jobs = queue.jobs.filter((j) => j.id !== jobId);
  await save();
  emit();
}

export async function removeJobsForVideo(videoId) {
  queue.jobs = queue.jobs.filter((j) => j.videoId !== videoId || j.status === 'running');
  await save();
  emit();
}

export async function setPaused(paused) {
  queue.paused = paused;
  await save();
  emit();
  kick();
}

export function cancelRunning() {
  current?.controller.abort();
}

function kick() {
  if (current || queue.paused) return;
  const job = queue.jobs.find((j) => j.status === 'queued');
  if (!job) return;
  runJob(job);
}

async function runJob(job) {
  const controller = new AbortController();
  current = { job, controller };
  Object.assign(job, { status: 'running', startedAt: new Date().toISOString(), label: 'Starting', progress: 0 });
  await save();
  emit();

  const t0 = Date.now();
  let lastEmit = 0;
  const report = ({ phase, label, progress }) => {
    job.phase = phase;
    job.label = label;
    job.progress = Math.max(0, Math.min(1, progress));
    const elapsed = (Date.now() - t0) / 1000;
    job.eta = job.progress > 0.04 ? Math.round((elapsed * (1 - job.progress)) / job.progress) : null;
    const now = Date.now();
    if (now - lastEmit > 250) {
      lastEmit = now;
      broadcast('job', { id: job.id, phase, label, progress: job.progress, eta: job.eta });
    }
  };

  try {
    const meta = getVideo(job.videoId);
    const result = await compress({ meta, profile: job.profile, target: job.target, max: job.max, signal: controller.signal, report });
    if (result.efficient) {
      Object.assign(job, { status: 'efficient', label: 'Already efficient — the original is smaller', result });
    } else {
      const fresh = getVideo(job.videoId);
      fresh.outputs.push(result);
      await saveVideo(fresh);
      Object.assign(job, { status: 'done', label: 'Done', result });
    }
    job.progress = 1;
  } catch (err) {
    await fsp.rm(workDir(job.videoId), { recursive: true, force: true }).catch(() => {});
    if (err.cancelled) Object.assign(job, { status: 'cancelled', label: 'Cancelled' });
    else Object.assign(job, { status: 'failed', label: 'Failed', error: err.message });
  } finally {
    job.finishedAt = new Date().toISOString();
    job.eta = null;
    current = null;
    await save();
    emit();
    kick();
  }
}
