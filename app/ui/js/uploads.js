import { state, changed } from './store.js';
import { uploadFile } from './api.js';
import { toast, toggleDrawer, go } from './app.js';

let running = false;
let seq = 0;

/** Copies files into the library one at a time (parallel copies only fight over the disk). */
export function startUploads(files) {
  if (!files.length) return;
  if (!state.tools?.ready) {
    toast({ kind: 'error', title: 'Set up the tools first', body: 'LocalPress needs ffmpeg in its folder before it can read videos.', action: { label: 'Open Tools', run: () => toggleDrawer('tools', true) } });
    return;
  }
  for (const file of files) {
    state.uploads.push({ id: ++seq, file, name: file.name, size: file.size, progress: 0, phase: 'waiting', error: null });
  }
  changed('uploads');
  if (location.hash.startsWith('#/v/')) go('#/');
  pump();
}

async function pump() {
  if (running) return;
  const next = state.uploads.find((u) => u.phase === 'waiting');
  if (!next) return;
  running = true;
  next.phase = 'uploading';
  changed('uploads');
  try {
    await uploadFile(next.file, (p, done) => {
      next.progress = p;
      if (done) next.phase = 'analyzing';
      changed('uploads');
    });
    state.uploads = state.uploads.filter((u) => u !== next);
  } catch (err) {
    next.phase = 'error';
    next.error = err.message;
  }
  running = false;
  changed('uploads');
  pump();
}

export function dismissUpload(id) {
  state.uploads = state.uploads.filter((u) => u.id !== id);
  changed('uploads');
}
