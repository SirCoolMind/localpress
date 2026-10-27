import { api } from './api.js';

export const state = {
  tools: null,
  library: { videos: [], disk: null },
  queue: { paused: false, jobs: [], running: null },
  options: null,
  uploads: [], // { id, name, size, progress, phase: 'uploading' | 'analyzing' | 'error', error }
  connected: false,
};

const listeners = new Set();
const jobListeners = new Set();
const finishListeners = new Set();

const subscribe = (set) => (fn) => {
  set.add(fn);
  return () => set.delete(fn);
};
export const onChange = subscribe(listeners);
export const onJobTick = subscribe(jobListeners);
/** Fires once per job when it reaches done/efficient/failed while the app is open. */
export const onJobFinished = subscribe(finishListeners);

let scheduled = false;
export function changed(part) {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const fn of listeners) fn(part);
  });
}

export const video = (id) => state.library.videos.find((v) => v.id === id);
export const jobsFor = (id) => state.queue.jobs.filter((j) => j.videoId === id);
export const runningJob = () => state.queue.jobs.find((j) => j.id === state.queue.running);

function applyQueue(next) {
  const before = new Map(state.queue.jobs.map((j) => [j.id, j.status]));
  state.queue = next;
  for (const job of next.jobs) {
    const was = before.get(job.id);
    if (was === 'running' && ['done', 'efficient', 'failed'].includes(job.status)) {
      for (const fn of finishListeners) fn(job);
    }
  }
}

export async function load() {
  const s = await api('GET', '/api/state');
  state.tools = s.tools;
  state.library = s.library;
  state.queue = s.queue;
  state.options = s.options;
  changed('all');
}

export function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => {
    // Re-sync after a reconnect: we may have missed events.
    if (!state.connected) load().catch(() => {});
    state.connected = true;
    changed('connection');
  });
  es.addEventListener('error', () => {
    state.connected = false;
    changed('connection');
  });
  es.addEventListener('tools', (e) => { state.tools = JSON.parse(e.data); changed('tools'); });
  es.addEventListener('library', (e) => { state.library = JSON.parse(e.data); changed('library'); });
  es.addEventListener('queue', (e) => {
    // Library outputs are saved before the queue event, so the finish moment can read them.
    applyQueue(JSON.parse(e.data));
    changed('queue');
  });
  es.addEventListener('job', (e) => {
    const tick = JSON.parse(e.data);
    const job = state.queue.jobs.find((j) => j.id === tick.id);
    if (job) Object.assign(job, tick);
    for (const fn of jobListeners) fn(tick);
  });
  es.addEventListener('bye', () => {
    state.connected = false;
    state.quit = true;
    es.close();
    changed('connection');
  });
}
