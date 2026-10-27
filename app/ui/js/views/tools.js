import { h, ic, replace, armed } from '../dom.js';
import { state } from '../store.js';
import { api } from '../api.js';
import { bytes, encoderLabel } from '../format.js';
import { toast } from '../app.js';

const INSTALL_LABEL = {
  downloading: 'Downloading', verifying: 'Checking the download', extracting: 'Unpacking', checking: 'Testing your encoders',
};
const ORDER = {
  archive: ['av1_nvenc', 'av1_qsv', 'av1_amf', 'libsvtav1'],
  share: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'],
};

const call = (path) => api('POST', path).catch((err) => toast({ kind: 'error', title: 'Tools', body: err.message }));

function statusIcon(kind) {
  const name = kind === 'ok' ? 'check' : kind === 'bad' ? 'x' : 'alert';
  return h(`span.ic.${kind}`, ic(name));
}

export function renderTools(el, close) {
  const t = state.tools;
  if (!t) return;
  const busy = Object.keys(INSTALL_LABEL).includes(t.install.state);

  // ffmpeg row
  let ffKind = 'bad';
  let ffDesc = `Not installed · ${bytes(t.pin.size)} download into the app folder`;
  if (t.ffmpeg.installed && !t.ffmpeg.missing.length) {
    ffKind = 'ok';
    ffDesc = `Version ${t.ffmpeg.version} · in app\\tools`;
  } else if (t.ffmpeg.installed) {
    ffKind = 'warn';
    ffDesc = `Missing ${t.ffmpeg.missing.join(', ')}. Reinstall to fix.`;
  }
  const ffAction = busy ? null
    : ffKind === 'ok' ? null
      : h('button.btn.small.primary', { type: 'button', onclick: () => call('/api/tools/install') }, ic('download'), ffKind === 'warn' ? 'Reinstall' : 'Install');

  const dl = busy || t.install.state === 'error'
    ? h('div.dl',
      t.install.state === 'error'
        ? h('div.hint-box', { role: 'alert' }, t.install.error)
        : [
          h('div.row', h('span', INSTALL_LABEL[t.install.state]),
            t.install.state === 'downloading' ? h('span.num', `${bytes(t.install.received)} / ${bytes(t.install.total)}`) : null),
          h('div.progress', h('i', { style: { transform: `scaleX(${t.install.state === 'downloading' ? t.install.received / t.install.total : 1})` } })),
        ])
    : null;

  const encoders = t.encoders
    ? Object.entries(ORDER).map(([profile, chain]) => {
      const use = chain.find((n) => t.encoders[n]) || chain.at(-1);
      return h('div.section',
        h('h3', profile === 'archive' ? 'Archive (AV1)' : 'Share (H.264)'),
        h('div.enc', chain.map((n) => [
          h('span.k', ic(t.encoders[n] ? 'check' : 'x', t.encoders[n] ? 'y' : 'n'), encoderLabel(n)),
          h(`span.v${n === use ? '.use' : ''}`, n === use ? 'Used' : t.encoders[n] ? 'Available' : 'Not available'),
        ])));
    })
    : h('div.section', h('p.faint', t.ffmpeg.installed ? 'Testing encoders…' : 'Encoders are tested after ffmpeg is installed.'));

  const uninstall = t.ffmpeg.installed
    ? armed(h('button.btn.small.danger', { type: 'button', disabled: busy }, ic('trash'), 'Uninstall tools'), 'Confirm uninstall', () => call('/api/tools/uninstall'))
    : null;

  replace(el,
    h('div.dh',
      h('h2', { tabindex: '-1' }, 'Tools'),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Close tools', onclick: close }, ic('close'))),
    h('div.db',
      h('div.section',
        h('div.tool', statusIcon(ffKind), h('span.nm', 'ffmpeg'), h('span.rt', ffAction), h('span.ds', ffDesc)),
        dl,
        h('div.tool', statusIcon(t.node.inApp ? 'ok' : 'warn'), h('span.nm', 'Node'), h('span.rt'),
          h('span.ds', `${t.node.version} · ${t.node.inApp ? 'portable copy in app\\runtime' : 'not the app’s own copy'}`)),
        h('div.tool', statusIcon(t.gpus.some((g) => /nvidia|intel|amd|radeon/i.test(g)) ? 'ok' : 'warn'), h('span.nm', 'Graphics'), h('span.rt'),
          h('span.ds', t.gpus.length ? t.gpus.join(' · ') : 'Not detected'))),
      t.hints.length ? h('div.section', t.hints.map((x) => h('div.hint-box', x.text, x.link ? [' ', h('a', { href: x.link, target: '_blank', rel: 'noreferrer' }, 'Driver downloads')] : null))) : null,
      encoders,
      h('div.section',
        h('p.faint', { style: { fontSize: '12.5px' } }, 'Everything LocalPress needs lives inside its own folder. Tools installed elsewhere on this PC are never used, and videos never leave it.'),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          h('button.btn.small', { type: 'button', disabled: t.checking || busy, onclick: () => call('/api/tools/recheck') }, ic('retry'), t.checking ? 'Checking…' : 'Re-check'),
          uninstall,
          h('button.btn.small.ghost', { type: 'button', onclick: () => call('/api/quit') }, ic('power'), 'Quit LocalPress')))));
}
