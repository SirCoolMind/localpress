import { h, ic, replace } from '../dom.js';
import { state, onJobTick, jobsFor } from '../store.js';
import { api } from '../api.js';
import { bytes, duration, saving, pct } from '../format.js';
import { chooseFiles, toggleDrawer, toast } from '../app.js';
import { dismissUpload } from '../uploads.js';
import { loadChoice, choiceControls } from '../settings.js';

export const bestOutput = (v) => v.outputs.reduce((b, o) => (!b || o.size < b.size ? o : b), null);

export function ratioBar(v, { large = false } = {}) {
  const best = bestOutput(v);
  if (!best) {
    return h('div.ratio.none', h('div.bar'), h('div.fig', h('span.num', bytes(v.source.size)), h('span', 'Not compressed yet')));
  }
  const s = saving(v.source.size, best.size);
  return h(`div.ratio${large ? '.large' : ''}`,
    h('div.bar', { title: `${bytes(best.size)} of ${bytes(v.source.size)}` }, h('i', { style: { width: `${Math.max(0.8, (1 - s) * 100)}%` } })),
    h('div.fig', h('span.num', `${bytes(v.source.size)} → ${bytes(best.size)}`), h('span.num.save', pct(s))));
}

export function mountLibrary(root) {
  const selected = new Set();
  let choice = loadChoice();

  function setupBanner() {
    const t = state.tools;
    if (!t || t.ready) return null;
    const installing = ['downloading', 'verifying', 'extracting', 'checking'].includes(t.install.state);
    if (t.checking && t.ffmpeg.installed) return null;
    return h('section.setup', { 'aria-label': 'One-time setup' },
      h('div.glyph', ic('tools')),
      h('div',
        h('h2', installing ? 'Setting up ffmpeg…' : 'One-time setup'),
        h('p', installing
          ? 'Downloading into the LocalPress folder. You can keep using the page.'
          : `LocalPress needs ffmpeg (${bytes(t.pin.size)} download) in its own folder to read and compress videos. Nothing else on your PC changes.`)),
      h('button.btn.primary', { type: 'button', onclick: () => toggleDrawer('tools', true) }, installing ? 'View progress' : 'Set up'));
  }

  function uploadsList() {
    if (!state.uploads.length) return null;
    return h('section.uploads', { 'aria-label': 'Imports' }, state.uploads.map((u) => {
      const label = u.phase === 'waiting' ? 'Waiting'
        : u.phase === 'uploading' ? `Copying in · ${Math.round(u.progress * 100)}%`
          : u.phase === 'analyzing' ? 'Analysing' : 'Failed';
      return h(`div.upload${u.phase === 'analyzing' ? '.analyzing' : ''}${u.phase === 'error' ? '.error' : ''}`,
        h('span.name', u.name),
        h('span.num.muted', u.phase === 'error'
          ? h('button.btn.small.ghost', { type: 'button', onclick: () => dismissUpload(u.id) }, 'Dismiss')
          : `${label} · ${bytes(u.size)}`),
        u.phase === 'error' ? h('div.err', u.error) : h('div.track', h('i', { style: { transform: `scaleX(${u.progress})` } })));
    }));
  }

  function frame(v) {
    const jobs = jobsFor(v.id);
    const running = jobs.find((j) => j.status === 'running');
    const queued = jobs.filter((j) => j.status === 'queued').length;
    const last = jobs.at(-1);
    let state_ = null;
    if (running) state_ = h('span.chip.accent.num', { dataset: { jobLabel: running.id } }, `${Math.round(running.progress * 100)}%`);
    else if (queued) state_ = h('span.chip', `Queued${queued > 1 ? ` ×${queued}` : ''}`);
    else if (last?.status === 'failed') state_ = h('span.chip.danger', 'Failed');
    else if (last?.status === 'interrupted') state_ = h('span.chip.warn', 'Interrupted');

    const href = `#/v/${encodeURIComponent(v.id)}`;
    const isSel = selected.has(v.id);
    const type = v.contentType.override || v.contentType.detected;
    return h(`a.frame${isSel ? '.selected' : ''}`, { href, 'aria-label': `${v.id}, ${bytes(v.source.size)}` },
      v.sourceRemoved ? null : h('button.pick', {
        type: 'button',
        'aria-label': isSel ? `Deselect ${v.id}` : `Select ${v.id}`,
        'aria-pressed': String(isSel),
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (selected.has(v.id)) selected.delete(v.id);
          else selected.add(v.id);
          render();
        },
      }, ic('check')),
      h('div.shot',
        h('img', { src: `/media/${encodeURIComponent(v.id)}/thumb`, alt: '', loading: 'lazy', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
        h('div.badge',
          h('span.num', duration(v.source.duration)),
          h('span', type === 'screen' ? 'Screen' : 'Camera')),
        state_ ? h('div.state', state_) : null,
        running ? h('div.exposure', h('i', { dataset: { jobBar: running.id }, style: { transform: `scaleX(${running.progress})` } })) : null),
      h('div.info',
        h('div.name', v.id),
        ratioBar(v)));
  }

  function selbar() {
    const ids = [...selected].filter((id) => state.library.videos.some((v) => v.id === id));
    if (!ids.length) return null;
    return h('div.selbar', { role: 'region', 'aria-label': 'Selection' },
      h('span', h('b.num', String(ids.length)), ' selected'),
      choiceControls(choice, (c) => { choice = c; render(); }, { compact: true, targets: state.options?.targets }),
      h('button.btn.primary', {
        type: 'button',
        onclick: async () => {
          try {
            await api('POST', '/api/queue', { videoIds: ids, ...choice });
            selected.clear();
            render();
            toast({ title: `Queued ${ids.length} video${ids.length > 1 ? 's' : ''}`, body: 'They run one at a time. Follow along in the queue.', action: { label: 'Open queue', run: () => toggleDrawer('queue', true) } });
          } catch (err) {
            toast({ kind: 'error', title: 'Could not queue', body: err.message });
          }
        },
      }, 'Compress'),
      h('button.btn.ghost', { type: 'button', onclick: () => { selected.clear(); render(); } }, 'Clear'));
  }

  function render() {
    const videos = state.library.videos;
    const saved = videos.reduce((sum, v) => {
      const b = bestOutput(v);
      return sum + (b ? v.source.size - b.size : 0);
    }, 0);
    const empty = !videos.length && !state.uploads.length;

    replace(root,
      h('div.lib-head',
        h('div',
          h('h1', 'Library'),
          h('p.sub', videos.length
            ? [h('span.num', String(videos.length)), ` video${videos.length === 1 ? '' : 's'}`, saved > 0 ? [' · ', h('span.num', bytes(saved)), ' saved so far'] : '']
            : 'Your recordings, copied in and compressed here.')),
        empty ? null : h('div.actions',
          h('button.btn', { type: 'button', onclick: chooseFiles, disabled: !state.tools?.ready }, ic('upload'), 'Choose files'))),
      setupBanner(),
      uploadsList(),
      empty
        ? h('section.stage', { 'aria-label': 'Add videos' },
          h('div.inner',
            h('div.glyph', ic('film')),
            h('h1', 'Drop a recording anywhere'),
            h('p', 'LocalPress copies it into its library, then finds the smallest file that still looks the same. Your original is never touched.'),
            h('div.row',
              h('button.btn.primary', { type: 'button', onclick: chooseFiles, disabled: !state.tools?.ready }, ic('upload'), 'Choose files')),
            h('p.faint', { style: { fontSize: '13px' } }, 'MP4, MKV, MOV, WebM, AVI and more. Videos never leave this PC.')))
        : h(`div.sheet${selected.size ? '.selecting' : ''}`, videos.map(frame)),
      selbar());
  }

  const offTick = onJobTick((tick) => {
    root.querySelectorAll(`[data-job-bar="${tick.id}"]`).forEach((el) => { el.style.transform = `scaleX(${tick.progress})`; });
    root.querySelectorAll(`[data-job-label="${tick.id}"]`).forEach((el) => { el.textContent = `${Math.round(tick.progress * 100)}%`; });
  });

  render();
  return {
    update: (part) => { if (part !== 'connection') render(); },
    destroy: () => offTick?.(),
  };
}
