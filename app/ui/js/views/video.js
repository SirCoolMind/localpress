import { h, ic, replace, armed } from '../dom.js';
import { state, video as getMeta, jobsFor, onJobTick, onJobFinished } from '../store.js';
import { api, enc } from '../api.js';
import { bytes, duration, saving, pct, ratioText, outputTitle, encoderLabel, eta } from '../format.js';
import { go, toast, toggleDrawer } from '../app.js';
import { loadChoice, choiceControls } from '../settings.js';
import { openCompare, closeCompare } from './compare.js';

const sortOutputs = (outs) => [...outs].sort((a, b) => a.size - b.size);

export function mountVideo(root, id) {
  let choice = loadChoice();
  let playing = 'source'; // 'source' or an output file name
  let fresh = null; // output file that just finished while this page was open
  let freshPlayed = false;
  let previewStep = 0;

  const playerVideo = h('video', { controls: true, preload: 'metadata', playsInline: true });
  const playerCap = h('div.cap');
  const playerNotice = h('div.notice', { hidden: true });
  const player = h('div.player', playerVideo, playerCap, playerNotice);
  const titleEl = h('div.vtitle');
  const printEl = h('section.print', { 'aria-label': 'Result' });
  const sideEl = h('div.side');

  replace(root,
    h('nav.crumbs', { 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, ic('back'), 'Library')),
    h('div.vpage',
      h('div', titleEl, player, printEl),
      sideEl));

  const meta = () => getMeta(id);
  const mediaBase = `/media/${enc(id)}`;

  // ---------- Player ----------
  function setNotice(text) {
    playerNotice.hidden = !text;
    replace(playerNotice, text ? h('p', text) : null);
  }

  function load(which) {
    const m = meta();
    if (!m) return;
    playing = which;
    previewStep = 0;
    setNotice(null);
    let src;
    let label;
    if (which === 'source') {
      if (m.sourceRemoved) {
        playerVideo.removeAttribute('src');
        playerVideo.load();
        setNotice('The source copy was removed to save space. Pick a version to play it.');
        replace(playerCap, h('span', 'Original'));
        return;
      }
      src = m.preview ? `${mediaBase}/preview` : `${mediaBase}/source`;
      label = [h('span', 'Original'), h('span.num', bytes(m.source.size))];
    } else {
      const o = m.outputs.find((x) => x.file === which);
      if (!o) return load('source');
      src = `${mediaBase}/outputs/${enc(o.file)}`;
      label = [h('span', outputTitle(o)), h('span.num', bytes(o.size))];
    }
    replace(playerCap, label);
    playerVideo.src = src;
  }

  playerVideo.addEventListener('error', async () => {
    const m = meta();
    if (!m || playing !== 'source' || m.sourceRemoved) {
      if (playing !== 'source') setNotice('This browser cannot play this version. Use Download or Show in Explorer to open it in a video player.');
      return;
    }
    // Remux first (instant); if the codec itself is the problem, make an H.264 proxy.
    const mode = previewStep === 0 && m.preview?.mode !== 'proxy' && m.preview?.mode !== 'remux' ? 'remux' : previewStep <= 1 && m.preview?.mode !== 'proxy' ? 'proxy' : null;
    previewStep += 1;
    if (!mode) {
      setNotice('This browser cannot play the original. Compression still works; use Show in Explorer to view it.');
      return;
    }
    setNotice(mode === 'remux' ? 'Preparing a copy this browser can play…' : 'Making a quick preview this browser can play (viewing only)…');
    try {
      await api('POST', `/api/videos/${enc(id)}/preview`, { mode });
      setNotice(null);
      playerVideo.src = `${mediaBase}/preview?v=${Date.now()}`;
    } catch (err) {
      setNotice(`Could not prepare a preview: ${err.message}`);
    }
  });

  // ---------- Title ----------
  function renderTitle(m) {
    const type = m.contentType.override || m.contentType.detected;
    replace(titleEl,
      h('h1', m.id),
      h('span.chip', ic(type === 'screen' ? 'screen' : 'camera'), type === 'screen' ? 'Screen recording' : 'Camera footage'));
  }

  // ---------- Result print (signature moment) ----------
  function renderPrint(m) {
    const outs = sortOutputs(m.outputs);
    if (!outs.length) {
      printEl.hidden = true;
      return;
    }
    printEl.hidden = false;
    const best = outs[0];
    const s = saving(m.source.size, best.size);
    const lane = (label, size, cls, file) => h(`div.lane${cls}`, file ? { dataset: { file } } : {},
      h('span.label', label),
      h('div.track', h('i', { style: { width: `${Math.max(0.4, (size / m.source.size) * 100)}%` } })),
      h('span.val.num', bytes(size)));
    // Play the collapse once; later re-renders show the settled state.
    printEl.className = `print${fresh && !freshPlayed ? ' fresh' : ''}`;
    if (fresh && !freshPlayed) setTimeout(() => { freshPlayed = true; }, 2600);
    replace(printEl,
      h('div.head',
        h('h2', fresh ? 'Just finished' : 'Best result'),
        h('span.faint', `${outputTitle(best)} · VMAF `, h('span.num', String(best.vmaf)))),
      h('div.big',
        h('span.pct', pct(s)),
        h('span.sizes', h('b', bytes(m.source.size)), ' → ', h('b', bytes(best.size)), h('span.faint', ` · ${ratioText(m.source.size, best.size)}`))),
      h('div.lanes',
        lane('Original', m.source.size, ''),
        // The freshest output collapses from full length; others show their final size.
        (fresh ? [...outs].sort((a, b) => (a.file === fresh ? -1 : b.file === fresh ? 1 : a.size - b.size)) : outs)
          .map((o) => lane(outputTitle(o), o.size, `.made${fresh && o.file !== fresh ? '.settled' : ''}`, o.file))));
    // Only the fresh lane animates.
    printEl.querySelectorAll('.lane.made.settled .track i').forEach((el) => { el.style.animation = 'none'; });
  }

  // ---------- Side ----------
  function jobLines(m) {
    const jobs = jobsFor(m.id).filter((j) => ['running', 'queued', 'failed', 'interrupted'].includes(j.status));
    const recentFail = jobs.filter((j) => j.status === 'failed' || j.status === 'interrupted').slice(-1);
    const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
    return [...active, ...recentFail].map((j) => {
      const desc = `${outputTitle(j)} · VMAF ${j.target}`;
      if (j.status === 'queued') {
        return h('div.jobline', h('div.row', h('span', desc), h('span.faint', state.queue.paused ? 'Queued · paused' : 'Queued')),
          h('div', h('button.btn.small.ghost', { type: 'button', onclick: () => api('POST', `/api/queue/${j.id}/cancel`).catch((e) => toast({ kind: 'error', title: 'Could not cancel', body: e.message })) }, 'Cancel')));
      }
      if (j.status === 'running') {
        return h('div.jobline',
          h('div.row', h('span', desc), h('span.num.faint', { dataset: { jobPct: j.id } }, `${Math.round(j.progress * 100)}%`)),
          h('div.progress', h('i', { dataset: { jobBar: j.id }, style: { transform: `scaleX(${j.progress})` } })),
          h('div.row', h('span.muted', { dataset: { jobLabel: j.id } }, j.label), h('span.faint', { dataset: { jobEta: j.id } }, eta(j.eta))),
          h('div', h('button.btn.small.ghost', { type: 'button', onclick: () => api('POST', `/api/queue/${j.id}/cancel`) }, ic('close'), 'Cancel')));
      }
      return h('div.jobline',
        h('div.row', h('span', desc), h(`span.chip.${j.status === 'failed' ? 'danger' : 'warn'}`, j.status === 'failed' ? 'Failed' : 'Interrupted')),
        j.error ? h('p.faint', { style: { fontSize: '12.5px' } }, j.error.split('\n')[0]) : null,
        h('div', h('button.btn.small', { type: 'button', onclick: () => api('POST', `/api/queue/${j.id}/retry`).catch((e) => toast({ kind: 'error', title: 'Could not retry', body: e.message })) }, ic('retry'), 'Retry')));
    });
  }

  function newVersionPanel(m) {
    const ready = state.tools?.ready;
    const disabledWhy = m.sourceRemoved ? 'The source copy was removed, so new versions are not possible.' : !ready ? 'Set up the tools first.' : null;
    return h('section.panel', { 'aria-labelledby': 'nv-h' },
      h('div.ph', h('h2', { id: 'nv-h' }, 'New version')),
      jobLines(m),
      h('div.pb',
        choiceControls(choice, (c) => { choice = c; renderSide(); }, { targets: state.options?.targets }),
        h('div.go',
          h('button.btn.primary', {
            type: 'button',
            disabled: Boolean(disabledWhy),
            title: disabledWhy || undefined,
            onclick: async () => {
              try {
                await api('POST', '/api/queue', { videoIds: [m.id], ...choice });
              } catch (err) {
                toast({ kind: 'error', title: 'Could not queue', body: err.message });
              }
            },
          }, 'Compress')),
        disabledWhy ? h('p.faint', { style: { fontSize: '12.5px' } }, disabledWhy, !ready && !m.sourceRemoved ? [' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); toggleDrawer('tools', true); } }, 'Open Tools')] : null) : null));
  }

  function versionsPanel(m) {
    const outs = sortOutputs(m.outputs);
    return h('section.panel', { 'aria-labelledby': 'vs-h' },
      h('div.ph', h('h2', { id: 'vs-h' }, 'Versions'), h('span.faint.num', String(outs.length))),
      outs.length
        ? h('div.outs', outs.map((o, i) => {
          const s = saving(m.source.size, o.size);
          const del = armed(h('button.icon-btn.danger', { type: 'button', 'aria-label': `Delete ${outputTitle(o)}`, title: 'Delete' }, ic('trash')), 'Confirm delete', async () => {
            try {
              await api('DELETE', `/api/videos/${enc(m.id)}/outputs/${enc(o.file)}`);
              if (playing === o.file) load('source');
            } catch (err) {
              toast({ kind: 'error', title: 'Could not delete', body: err.message });
            }
          });
          return h(`div.out${playing === o.file ? '.active' : ''}`,
            h('div.t', h('span', outputTitle(o)), i === 0 && outs.length > 1 ? h('span.best', 'Smallest') : null),
            h('div.acts',
              h('button.icon-btn', { type: 'button', 'aria-label': `Play ${outputTitle(o)}`, title: 'Play', onclick: () => { load(o.file); renderSide(); } }, ic('play')),
              m.sourceRemoved ? null : h('button.icon-btn', { type: 'button', 'aria-label': `Compare ${outputTitle(o)} with the original`, title: 'Compare', onclick: () => go(`#/v/${enc(m.id)}/compare/${enc(o.file)}`) }, ic('compare')),
              h('a.icon-btn', { href: `${mediaBase}/outputs/${enc(o.file)}?download`, 'aria-label': `Download ${outputTitle(o)}`, title: 'Download', download: '' }, ic('download')),
              h('button.icon-btn', { type: 'button', 'aria-label': 'Show in Explorer', title: 'Show in Explorer', onclick: () => api('POST', `/api/videos/${enc(m.id)}/reveal`, { file: o.file }) }, ic('folder')),
              del),
            h('div.figs',
              h('span.num', h('b', bytes(o.size))),
              h('span.num.save', pct(s)),
              o.metTarget === false
                ? h('span.num.miss', { title: `Asked for VMAF ${o.target}; this is the best the encoder reached. It may show visible differences.` }, `VMAF ${o.vmaf} · below ${o.target}`)
                : h('span.num', `VMAF ${o.vmaf}`),
              h('span', { title: `Encoder: ${encoderLabel(o.encoder)}` }, encoderLabel(o.encoder)),
              h('span.num', duration(o.encodeSeconds))));
        }))
        : h('p.empty-outs', 'No versions yet. Choose a profile and press Compress.'));
  }

  function sourcePanel(m) {
    const type = m.contentType.override || m.contentType.detected;
    const s = m.source;
    const fact = (k, v) => [h('dt', k), h('dd', v)];
    const removeSource = armed(h('button.btn.small.danger', { type: 'button' }, 'Remove source copy'), 'Confirm: keep versions only', async () => {
      try {
        await api('POST', `/api/videos/${enc(m.id)}/remove-source`);
        load(sortOutputs(meta().outputs)[0]?.file || 'source');
      } catch (err) {
        toast({ kind: 'error', title: 'Could not remove the source', body: err.message });
      }
    });
    const removeVideo = armed(h('button.btn.small.danger', { type: 'button' }, 'Remove from library'), 'Confirm: delete folder', async () => {
      try {
        await api('DELETE', `/api/videos/${enc(m.id)}`);
        go('#/');
      } catch (err) {
        toast({ kind: 'error', title: 'Could not remove', body: err.message });
      }
    });
    return h('section.panel', { 'aria-labelledby': 'src-h' },
      h('div.ph', h('h2', { id: 'src-h' }, 'Source'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => api('POST', `/api/videos/${enc(m.id)}/reveal`, {}) }, ic('folder'), 'Show in Explorer')),
      h('div.pb',
        h('div.field', h('span', 'Content'),
          h('div.seg', { role: 'group', 'aria-label': 'Content type' },
            ['screen', 'camera'].map((t) => h('button', {
              type: 'button',
              'aria-pressed': String(type === t),
              onclick: () => api('PATCH', `/api/videos/${enc(m.id)}`, { contentType: t }).catch((e) => toast({ kind: 'error', title: 'Could not change', body: e.message })),
            }, ic(t), t === 'screen' ? 'Screen' : 'Camera'))),
          h('span.hint', m.contentType.override
            ? `You set this. LocalPress guessed ${m.contentType.detected}.`
            : `Detected: ${Math.round(m.contentType.dupRatio * 100)}% of frames repeat. Screen recordings drop repeated frames.`)),
        h('dl.facts',
          fact('File', m.originalName),
          fact('Size', h('span.num', m.sourceRemoved ? `${bytes(s.size)} (removed)` : bytes(s.size))),
          fact('Length', h('span.num', duration(s.duration))),
          fact('Picture', h('span.num', `${s.width}×${s.height} · ${Math.round(s.fps * 100) / 100} fps${s.interlaced ? ' · interlaced' : ''}${s.hdr ? ' · HDR' : ''}`)),
          fact('Video', `${s.vcodec.toUpperCase()}${s.bitrate ? ` · ${Math.round(s.bitrate / 1e5) / 10} Mbps` : ''}${s.hdr ? ' · HDR' : ''}`),
          fact('Audio', s.acodec ? `${s.acodec.toUpperCase()}${s.abitrate ? ` · ${Math.round(s.abitrate / 1000)} kbps` : ''}${s.audioTracks?.length > 1 ? ` + ${s.audioTracks.length - 1} more track${s.audioTracks.length > 2 ? 's' : ''}` : ''}` : 'None')),
        h('div.dangerzone', m.sourceRemoved ? null : removeSource, removeVideo)));
  }

  function renderSide() {
    const m = meta();
    if (!m) return;
    replace(sideEl, newVersionPanel(m), versionsPanel(m), sourcePanel(m));
  }

  function renderAll() {
    const m = meta();
    if (!m) {
      replace(root, h('div.stage', h('div.inner', h('div.glyph', ic('film')), h('h1', 'This video is not in the library'), h('p', 'It may have been removed.'), h('a.btn', { href: '#/' }, 'Back to library'))));
      return;
    }
    document.title = `${m.id} · LocalPress`;
    renderTitle(m);
    renderPrint(m);
    renderSide();
  }

  const offTick = onJobTick((tick) => {
    const w = `${Math.round(tick.progress * 100)}%`;
    sideEl.querySelectorAll(`[data-job-bar="${tick.id}"]`).forEach((el) => { el.style.transform = `scaleX(${tick.progress})`; });
    sideEl.querySelectorAll(`[data-job-pct="${tick.id}"]`).forEach((el) => { el.textContent = w; });
    sideEl.querySelectorAll(`[data-job-label="${tick.id}"]`).forEach((el) => { el.textContent = tick.label; });
    sideEl.querySelectorAll(`[data-job-eta="${tick.id}"]`).forEach((el) => { el.textContent = eta(tick.eta); });
  });

  const offFinish = onJobFinished((job) => {
    if (job.videoId !== id) return;
    if (job.status === 'done' && job.result) {
      fresh = job.result.file;
      freshPlayed = false;
      printEl.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    } else if (job.status === 'efficient') {
      toast({ title: 'Already efficient', body: 'The compressed version came out bigger than the original, so it was discarded.' });
    } else if (job.status === 'failed') {
      toast({ kind: 'error', title: 'Compression failed', body: (job.error || '').split('\n')[0] });
    }
  });

  load('source');
  renderAll();

  return {
    update: (part) => {
      if (part === 'connection' || part === 'uploads') return;
      if (!meta()) return renderAll();
      renderTitle(meta());
      renderPrint(meta());
      renderSide();
    },
    route: (r) => {
      const m = meta();
      if (r.compare && m) {
        const o = m.outputs.find((x) => x.file === r.compare);
        if (o && !m.sourceRemoved) openCompare(m, o, () => go(`#/v/${enc(id)}`));
        else go(`#/v/${enc(id)}`);
      } else {
        closeCompare();
      }
    },
    destroy: () => {
      offTick();
      offFinish();
      closeCompare();
      playerVideo.removeAttribute('src');
      playerVideo.load();
      document.title = 'LocalPress';
    },
  };
}
