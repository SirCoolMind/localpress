import { h, ic, replace } from './dom.js';
import { state, load, connect, onChange, onJobTick, onJobFinished, video, runningJob } from './store.js';
import { bytes, saving, pct, ratioText } from './format.js';
import { mountLibrary } from './views/library.js';
import { mountVideo } from './views/video.js';
import { renderQueue } from './views/queue.js';
import { renderTools } from './views/tools.js';
import { startUploads } from './uploads.js';

const main = document.getElementById('main');
const queueBtn = document.getElementById('queue-btn');
const toolsBtn = document.getElementById('tools-btn');
const queueDrawer = document.getElementById('queue-drawer');
const toolsDrawer = document.getElementById('tools-drawer');
const scrim = document.getElementById('scrim');
const fileInput = document.getElementById('file-input');

let view = null;
let viewKey = '';

// ---------- Routing ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'v' && parts[1]) return { name: 'video', id: parts[1], compare: parts[2] === 'compare' ? parts[3] : null };
  return { name: 'library' };
}

export function go(hash) {
  if (location.hash !== hash) location.hash = hash;
}

function route() {
  const r = parseRoute();
  const key = r.name === 'video' ? `video:${r.id}` : 'library';
  if (key !== viewKey) {
    view?.destroy?.();
    viewKey = key;
    view = r.name === 'video' ? mountVideo(main, r.id) : mountLibrary(main);
    window.scrollTo(0, 0);
  }
  view.route?.(r);
}

// ---------- Drawers ----------
let openDrawer = null;
let lastFocus = null;
export function toggleDrawer(which, force) {
  const target = which === 'queue' ? queueDrawer : toolsDrawer;
  const willOpen = force ?? openDrawer !== target;
  for (const [d, b] of [[queueDrawer, queueBtn], [toolsDrawer, toolsBtn]]) {
    const on = willOpen && d === target;
    d.hidden = !on;
    b.setAttribute('aria-expanded', String(on));
  }
  scrim.hidden = !willOpen;
  if (willOpen) {
    lastFocus = document.activeElement;
    openDrawer = target;
    renderDrawers();
    target.querySelector('h2')?.focus();
  } else {
    openDrawer = null;
    lastFocus?.focus?.();
  }
}
scrim.addEventListener('click', () => toggleDrawer(null, false));
queueBtn.addEventListener('click', () => toggleDrawer('queue'));
toolsBtn.addEventListener('click', () => toggleDrawer('tools'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openDrawer && document.getElementById('compare').hidden) toggleDrawer(null, false);
});

function renderDrawers() {
  if (!queueDrawer.hidden) renderQueue(queueDrawer, () => toggleDrawer(null, false));
  if (!toolsDrawer.hidden) renderTools(toolsDrawer, () => toggleDrawer(null, false));
}

// ---------- Top bar ----------
function renderTopbar() {
  const d = state.library.disk;
  const disk = document.getElementById('disk');
  if (d) {
    const used = d.total ? (d.total - d.free) / d.total : 0;
    replace(disk,
      h('span', 'Library ', h('b.num', bytes(d.library))),
      h('span.meter', { title: `Disk ${Math.round(used * 100)}% full` }, h('i', { style: { width: `${Math.round(used * 100)}%` } })),
      h('span', h('b.num', bytes(d.free)), ' free'));
  }

  const active = state.queue.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const running = runningJob();
  queueBtn.classList.toggle('running', Boolean(running));
  replace(queueBtn, ic('queue'), h('span.label', 'Queue'), h('span.count.num', String(active)),
    running ? h('span.qbar', h('i', { style: { transform: `scaleX(${running.progress})` } })) : null);
  queueBtn.setAttribute('aria-label', `Queue, ${active} active${state.queue.paused ? ', paused' : ''}`);

  const t = state.tools;
  const dot = !t ? 'busy' : t.checking || ['downloading', 'verifying', 'extracting', 'checking'].includes(t.install.state) ? 'busy' : t.ready ? 'ok' : 'bad';
  replace(toolsBtn, h(`span.status-dot.${dot}`), ic('tools'), h('span.label', 'Tools'));
  toolsBtn.setAttribute('aria-label', `Tools, ${dot === 'ok' ? 'ready' : dot === 'busy' ? 'working' : 'needs setup'}`);
}

onJobTick((tick) => {
  const running = runningJob();
  const bar = queueBtn.querySelector('.qbar i');
  if (bar && running?.id === tick.id) bar.style.transform = `scaleX(${tick.progress})`;
  if (!queueDrawer.hidden) renderQueue(queueDrawer, () => toggleDrawer(null, false), tick);
});

// ---------- Toasts ----------
const toasts = document.getElementById('toasts');
export function toast({ title, body, kind, action, ratio, timeout = 7000 }) {
  const close = h('button.icon-btn', { type: 'button', 'aria-label': 'Dismiss', onclick: () => el.remove() }, ic('close'));
  const el = h(`div.toast${kind ? `.${kind}` : ''}`, { role: kind === 'error' ? 'alert' : 'status' },
    h('div.tt', h('span', title), close),
    body ? h('p', body) : null,
    ratio || null,
    action ? h('div', h('button.btn.small', { type: 'button', onclick: () => { action.run(); el.remove(); } }, action.label)) : null);
  toasts.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
}

onJobFinished((job) => {
  const meta = video(job.videoId);
  const onThisPage = parseRoute().name === 'video' && parseRoute().id === job.videoId;
  if (onThisPage) return; // the video page plays the full result moment itself
  if (job.status === 'failed') {
    toast({ kind: 'error', title: `Couldn't compress ${meta?.id || 'a video'}`, body: 'Open the queue to see what went wrong.', action: { label: 'Open queue', run: () => toggleDrawer('queue', true) } });
  } else if (job.status === 'efficient') {
    toast({ title: `${meta?.id} is already efficient`, body: 'The compressed version came out bigger, so it was discarded.' });
  } else if (job.result && meta) {
    const s = saving(meta.source.size, job.result.size);
    toast({
      title: `${meta.id} · ${pct(s)}`,
      body: `${bytes(meta.source.size)} → ${bytes(job.result.size)}, ${ratioText(meta.source.size, job.result.size)}, VMAF ${job.result.vmaf}`,
      ratio: h('div.ratio', h('div.bar', h('i', { style: { width: `${Math.max(1, (1 - s) * 100)}%` } }))),
      action: { label: 'View result', run: () => go(`#/v/${encodeURIComponent(meta.id)}`) },
      timeout: 12000,
    });
  }
});

// ---------- Files in ----------
export function chooseFiles() {
  fileInput.value = '';
  fileInput.click();
}
fileInput.addEventListener('change', () => startUploads([...fileInput.files]));

const veil = document.getElementById('dropveil');
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth += 1;
  veil.hidden = false;
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) veil.hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  veil.hidden = true;
  startUploads([...e.dataTransfer.files]);
});

// ---------- Boot ----------
onChange((part) => {
  if (state.quit) {
    replace(main, h('div.stage', h('div.inner', h('div.glyph', ic('power')), h('h1', 'LocalPress has stopped'), h('p', 'Run start.bat again to reopen it. Your library is safe in the videos folder.'))));
    return;
  }
  renderTopbar();
  renderDrawers();
  view?.update?.(part);
});

window.addEventListener('hashchange', route);
load()
  .then(() => {
    route();
    connect();
  })
  .catch((err) => {
    replace(main, h('div.stage', h('div.inner', h('div.glyph', ic('alert')), h('h1', 'Can’t reach LocalPress'), h('p', `${err.message}. Make sure the LocalPress window is still open, then reload this page.`))));
  });
