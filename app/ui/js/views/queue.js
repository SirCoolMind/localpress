import { h, ic, replace } from '../dom.js';
import { state, video } from '../store.js';
import { api, enc } from '../api.js';
import { bytes, eta, outputTitle, pct, saving } from '../format.js';
import { toast } from '../app.js';

const STATUS = {
  queued: 'Waiting', running: 'Running', done: 'Done', efficient: 'Already efficient',
  failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted',
};

const call = (method, path) => api(method, path).catch((err) => toast({ kind: 'error', title: 'Queue action failed', body: err.message }));

function jobRow(j) {
  const m = video(j.videoId);
  const desc = `${outputTitle(j)} · VMAF ${j.target}`;
  const acts = [];
  if (j.status === 'running' || j.status === 'queued') {
    acts.push(h('button.icon-btn', { type: 'button', 'aria-label': `Cancel ${j.videoId}`, title: 'Cancel', onclick: () => call('POST', `/api/queue/${j.id}/cancel`) }, ic('close')));
  }
  if (['failed', 'cancelled', 'interrupted'].includes(j.status)) {
    acts.push(h('button.icon-btn', { type: 'button', 'aria-label': `Retry ${j.videoId}`, title: 'Retry', onclick: () => call('POST', `/api/queue/${j.id}/retry`) }, ic('retry')));
  }
  if (j.status !== 'running') {
    acts.push(h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${j.videoId} from the list`, title: 'Remove from list', onclick: () => call('DELETE', `/api/queue/${j.id}`) }, ic('trash')));
  }

  let st;
  if (j.status === 'running') {
    st = [h('span', { dataset: { qLabel: j.id } }, j.label), h('span.num.faint', { dataset: { qEta: j.id } }, eta(j.eta))];
  } else if (j.status === 'done' && j.result && m) {
    st = [h('span', 'Done'), h('span.num', `${bytes(j.result.size)} · ${pct(saving(m.source.size, j.result.size))} · VMAF ${j.result.vmaf}`)];
  } else {
    st = [h('span', STATUS[j.status] || j.status), h('span.faint', desc)];
  }

  return h(`div.job.${j.status}`,
    h('a.th', {
      href: `#/v/${enc(j.videoId)}`,
      'aria-label': `Open ${j.videoId}`,
      style: { backgroundImage: `url("/media/${enc(j.videoId)}/thumb")` },
      onclick: () => setTimeout(() => document.getElementById('scrim').click(), 0),
    }),
    h('div.nm', j.videoId, j.status === 'running' || j.status === 'queued' ? h('span.faint', ` · ${desc}`) : null),
    h('div.acts', acts),
    h('div.st', st),
    j.status === 'running' ? h('div.progress', h('i', { dataset: { qBar: j.id }, style: { transform: `scaleX(${j.progress})` } })) : null,
    j.status === 'failed' && j.error ? h('div.err', j.error) : null);
}

export function renderQueue(el, close, tick) {
  if (tick) {
    el.querySelectorAll(`[data-q-bar="${tick.id}"]`).forEach((n) => { n.style.transform = `scaleX(${tick.progress})`; });
    el.querySelectorAll(`[data-q-label="${tick.id}"]`).forEach((n) => { n.textContent = tick.label; });
    el.querySelectorAll(`[data-q-eta="${tick.id}"]`).forEach((n) => { n.textContent = eta(tick.eta); });
    return;
  }
  const jobs = state.queue.jobs;
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const finished = jobs.filter((j) => !(j.status === 'running' || j.status === 'queued')).reverse();
  const paused = state.queue.paused;

  replace(el,
    h('div.dh',
      h('h2', { tabindex: '-1' }, 'Queue'),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        active.length || paused
          ? h('button.btn.small', { type: 'button', onclick: () => call('POST', `/api/queue/${paused ? 'resume' : 'pause'}`) }, ic(paused ? 'play' : 'pause'), paused ? 'Resume' : 'Pause')
          : null,
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close queue', onclick: close }, ic('close')))),
    h('div.db',
      paused && active.length ? h('div.section', h('div.hint-box', 'The queue is paused. Waiting jobs start when you press Resume. A job interrupted by closing the app can be retried below.')) : null,
      active.length ? h('div', active.map(jobRow)) : h('p.empty', jobs.length ? 'Nothing running.' : 'Nothing queued yet. Open a video and press Compress, or select several in the library.'),
      finished.length ? [h('div.section', h('h3', 'Earlier')), h('div', finished.map(jobRow))] : null));
}
