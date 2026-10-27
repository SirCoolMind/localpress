import { h, ic, replace } from '../dom.js';
import { enc } from '../api.js';
import { bytes, outputTitle, timecode, pct, saving } from '../format.js';

const root = document.getElementById('compare');
let session = null;

export function closeCompare() {
  if (!session) return;
  session.teardown();
  session = null;
}

/** Full-frame wipe compare: original under, output over, clipped at the handle. */
export function openCompare(meta, output, onClose) {
  if (session?.key === `${meta.id}/${output.file}`) return;
  closeCompare();

  const base = `/media/${enc(meta.id)}`;
  const fps = meta.source.fps || 30;
  const a = h('video', { src: meta.preview ? `${base}/preview` : `${base}/source`, preload: 'auto', playsInline: true });
  const b = h('video', { src: `${base}/outputs/${enc(output.file)}`, preload: 'auto', playsInline: true, muted: true });
  b.muted = true;

  let wipe = 50;
  let mode = 'wipe'; // wipe | a | b
  let zoomed = false;
  let dragging = false;

  const handle = h('div.handle', h('span', ic('grip')));
  const viewport = h('div.viewport', { tabindex: '-1' },
    h('div.layer.a', a), h('div.layer.b', b), handle,
    h('span.side-label.a', 'Original'),
    h('span.side-label.b', outputTitle(output)));
  const playBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Play' }, ic('play'));
  const tc = h('span.tc.num', timecode(0, fps));
  const scrub = h('input.scrub', { type: 'range', min: 0, max: meta.source.duration || 1, step: 'any', value: 0, 'aria-label': 'Position' });
  const modeSeg = h('div.seg.small', { role: 'group', 'aria-label': 'View' });
  const zoomBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Zoom 1:1 (Z)', 'aria-pressed': 'false', title: 'Zoom 1:1 (Z)' }, ic('zoom'));
  const keysBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Keyboard shortcuts (?)', title: 'Keyboard shortcuts (?)' }, ic('keyboard'));
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Close compare (Esc)', title: 'Close (Esc)' }, ic('close'));
  const keys = h('div.keys', { hidden: true },
    h('h3', 'Shortcuts'),
    h('dl',
      [['Space', 'Play / pause'], ['← →', 'Step one frame'], ['[ ]', 'Move the wipe'], ['Z', 'Zoom 1:1, follows the mouse'],
        ['1', 'Original only'], ['2', 'Output only'], ['?', 'This list'], ['Esc', 'Close']]
        .map(([k, d]) => [h('dt', k.split(' ').map((x) => h('kbd', x))), h('dd', d)])));

  const s = saving(meta.source.size, output.size);
  replace(root,
    h('div.bar',
      h('div.tag', h('b', 'Original'), h('span.num', bytes(meta.source.size))),
      h('div.tag.right',
        h('span.num', `${bytes(output.size)} · ${pct(s)} · VMAF ${output.vmaf}`),
        h('b', outputTitle(output)),
        closeBtn)),
    viewport,
    h('div.transport',
      h('div.grp',
        h('button.icon-btn', { type: 'button', 'aria-label': 'Previous frame', title: 'Previous frame (←)', onclick: () => step(-1) }, ic('stepBack')),
        playBtn,
        h('button.icon-btn', { type: 'button', 'aria-label': 'Next frame', title: 'Next frame (→)', onclick: () => step(1) }, ic('stepFwd')),
        tc),
      scrub,
      h('div.grp', modeSeg, zoomBtn, keysBtn)),
    keys);

  function renderMode() {
    viewport.classList.toggle('solo-a', mode === 'a');
    viewport.classList.toggle('solo-b', mode === 'b');
    replace(modeSeg, [['wipe', 'Wipe'], ['a', 'Original'], ['b', 'Output']].map(([v, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(mode === v), onclick: () => { mode = v; renderMode(); } }, label)));
  }
  const setWipe = (v) => {
    wipe = Math.max(0, Math.min(100, v));
    viewport.style.setProperty('--wipe', `${wipe}%`);
  };

  function togglePlay() {
    if (a.paused) {
      b.currentTime = a.currentTime;
      a.play().catch(() => {});
      b.play().catch(() => {});
    } else {
      a.pause();
      b.pause();
      b.currentTime = a.currentTime;
    }
  }
  function step(dir) {
    a.pause();
    b.pause();
    const t = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + dir / fps));
    a.currentTime = t;
    b.currentTime = t;
  }
  function setZoom(on, e) {
    zoomed = on && Boolean(a.videoWidth);
    viewport.classList.toggle('zoomed', zoomed);
    zoomBtn.setAttribute('aria-pressed', String(zoomed));
    let scale = 1;
    if (zoomed) {
      const r = viewport.getBoundingClientRect();
      const shown = Math.min(r.width, r.height * (a.videoWidth / a.videoHeight));
      scale = Math.max(1.5, a.videoWidth / shown);
      if (e) pan(e);
    }
    for (const v of [a, b]) v.style.transform = zoomed ? `scale(${scale})` : '';
  }
  function pan(e) {
    const r = viewport.getBoundingClientRect();
    viewport.style.setProperty('--zx', `${((e.clientX - r.left) / r.width) * 100}%`);
    viewport.style.setProperty('--zy', `${((e.clientY - r.top) / r.height) * 100}%`);
  }

  // Pointer: drag (or click) moves the wipe; while zoomed, hovering pans.
  viewport.addEventListener('pointerdown', (e) => {
    dragging = true;
    viewport.setPointerCapture(e.pointerId);
    const r = viewport.getBoundingClientRect();
    if (mode !== 'wipe') { mode = 'wipe'; renderMode(); }
    setWipe(((e.clientX - r.left) / r.width) * 100);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (zoomed) pan(e);
    if (!dragging) return;
    const r = viewport.getBoundingClientRect();
    setWipe(((e.clientX - r.left) / r.width) * 100);
  });
  viewport.addEventListener('pointerup', () => { dragging = false; });
  viewport.addEventListener('dblclick', (e) => setZoom(!zoomed, e));

  playBtn.addEventListener('click', togglePlay);
  zoomBtn.addEventListener('click', () => setZoom(!zoomed));
  keysBtn.addEventListener('click', () => { keys.hidden = !keys.hidden; });
  closeBtn.addEventListener('click', () => onClose());
  scrub.addEventListener('input', () => {
    a.currentTime = Number(scrub.value);
    b.currentTime = Number(scrub.value);
  });
  const syncPlayState = () => {
    replace(playBtn, ic(a.paused ? 'play' : 'pause'));
    playBtn.setAttribute('aria-label', a.paused ? 'Play' : 'Pause');
  };
  a.addEventListener('play', syncPlayState);
  a.addEventListener('pause', syncPlayState);
  a.addEventListener('ended', () => b.pause());

  // Keep the output locked to the original's clock.
  let raf = 0;
  const tick = () => {
    const drift = b.currentTime - a.currentTime;
    if (!a.paused && Math.abs(drift) > 0.12) b.currentTime = a.currentTime;
    else if (a.paused && Math.abs(drift) > 0.001 && !b.seeking) b.currentTime = a.currentTime;
    if (!a.paused && b.paused) b.play().catch(() => {});
    tc.textContent = timecode(a.currentTime, fps);
    if (document.activeElement !== scrub) scrub.value = String(a.currentTime);
    scrub.style.setProperty('--p', `${(a.currentTime / (a.duration || meta.source.duration || 1)) * 100}%`);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onKey = (e) => {
    if (e.target === scrub && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      if (!keys.hidden) keys.hidden = true;
      else onClose();
    } else if (k === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (k === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (k === '[') setWipe(wipe - 5);
    else if (k === ']') setWipe(wipe + 5);
    else if (k === 'z' || k === 'Z') setZoom(!zoomed);
    else if (k === '1') { mode = mode === 'a' ? 'wipe' : 'a'; renderMode(); }
    else if (k === '2') { mode = mode === 'b' ? 'wipe' : 'b'; renderMode(); }
    else if (k === '?') keys.hidden = !keys.hidden;
    else if (k === 'Tab') {
      // Keep focus inside the dialog.
      const items = [...root.querySelectorAll('button, input, [tabindex="-1"]')].filter((el) => !el.closest('[hidden]'));
      const first = items[0];
      const last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);

  const lastFocus = document.activeElement;
  setWipe(50);
  renderMode();
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  closeBtn.focus();

  session = {
    key: `${meta.id}/${output.file}`,
    teardown() {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      a.pause();
      b.pause();
      a.removeAttribute('src');
      b.removeAttribute('src');
      a.load();
      b.load();
      root.hidden = true;
      replace(root);
      document.body.style.overflow = '';
      lastFocus?.focus?.();
    },
  };
}
