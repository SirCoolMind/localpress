import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths, PORT_START, PORT_END, OPEN_BROWSER } from './lib/config.js';
import { rejectReason } from './lib/security.js';
import { createRouter, sendJson, readJson, serveFile, safeJoin, HttpError } from './lib/http.js';
import { subscribe, broadcast } from './lib/events.js';
import { toolsStatus, recheck, installFfmpeg, uninstallFfmpeg, installRunning } from './lib/tools.js';
import { PROFILES, TARGETS } from './lib/encoders.js';
import { isPlainSegment } from './lib/names.js';
import {
  loadLibrary, listVideos, getVideo, diskInfo, importUpload, setContentType, removeSource,
  deleteVideo, deleteOutput, ensurePreview, videoDir,
} from './lib/library.js';
import {
  loadQueue, queueState, addJobs, cancelJob, retryJob, removeJob, removeJobsForVideo, setPaused,
  isRunningFor, cancelRunning,
} from './lib/queue.js';

const router = createRouter();
const api = (method, pattern, handler) => router.add(method, pattern, handler);
let port = PORT_START;

api('GET', '/api/ping', () => ({ app: 'localpress', pid: process.pid }));

api('GET', '/api/state', async () => ({
  tools: toolsStatus(),
  library: { videos: listVideos(), disk: await diskInfo() },
  queue: queueState(),
  options: { profiles: PROFILES, targets: TARGETS },
}));

api('GET', '/api/events', (req, res) => {
  subscribe(req, res);
  return undefined;
});

api('POST', '/api/tools/recheck', () => recheck());
api('POST', '/api/tools/install', () => {
  installFfmpeg();
  return toolsStatus();
});
api('POST', '/api/tools/uninstall', async () => {
  if (queueState().running) throw new HttpError(409, 'Wait for the running job to finish or cancel it first.');
  if (installRunning()) throw new HttpError(409, 'An install is in progress.');
  await uninstallFfmpeg();
  return toolsStatus();
});

api('PUT', '/api/import', async (req) => {
  const name = decodeURIComponent(req.headers['x-file-name'] || '');
  const size = Number(req.headers['content-length']);
  return importUpload(req, name, size);
});

api('PATCH', '/api/videos/:id', async (req, res, { id }) => {
  const body = await readJson(req);
  return setContentType(id, body.contentType ?? null);
});

api('DELETE', '/api/videos/:id', async (req, res, { id }) => {
  if (isRunningFor(id)) throw new HttpError(409, 'Cancel the running job for this video first.');
  await removeJobsForVideo(id);
  await deleteVideo(id);
  return { ok: true };
});

api('POST', '/api/videos/:id/remove-source', async (req, res, { id }) => {
  if (isRunningFor(id)) throw new HttpError(409, 'Cancel the running job for this video first.');
  await removeJobsForVideo(id);
  return removeSource(id);
});

api('POST', '/api/videos/:id/preview', async (req, res, { id }) => {
  const body = await readJson(req);
  return ensurePreview(id, body.mode);
});

api('POST', '/api/videos/:id/reveal', async (req, res, { id }) => {
  const meta = getVideo(id);
  const body = await readJson(req);
  let target = videoDir(id);
  if (body.file) {
    if (!isPlainSegment(body.file) || !meta.outputs.some((o) => o.file === body.file)) throw new HttpError(404, 'Output not found');
    target = path.join(target, 'outputs', body.file);
  }
  spawn('explorer.exe', [`/select,"${target}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
  return { ok: true };
});

api('DELETE', '/api/videos/:id/outputs/:file', async (req, res, { id, file }) => deleteOutput(id, file));

api('POST', '/api/queue', async (req) => addJobs(await readJson(req)));
api('POST', '/api/queue/pause', () => setPaused(true).then(queueState));
api('POST', '/api/queue/resume', () => setPaused(false).then(queueState));
api('POST', '/api/queue/:job/cancel', async (req, res, { job }) => (await cancelJob(job), queueState()));
api('POST', '/api/queue/:job/retry', async (req, res, { job }) => (await retryJob(job), queueState()));
api('DELETE', '/api/queue/:job', async (req, res, { job }) => (await removeJob(job), queueState()));

api('POST', '/api/quit', () => {
  setTimeout(shutdown, 150);
  return { ok: true };
});

// Library media: source, preview, thumbnail, outputs.
router.add('GET', '/media/:id/:kind', (req, res, { id, kind }) => {
  const meta = getVideo(id);
  const dir = videoDir(id);
  if (kind === 'source' && !meta.sourceRemoved) return serveFile(req, res, path.join(dir, meta.source.file));
  if (kind === 'preview' && meta.preview) return serveFile(req, res, path.join(dir, '.preview', meta.preview.file));
  if (kind === 'thumb') return serveFile(req, res, path.join(dir, 'thumb.jpg'), { cache: 'max-age=60' });
  throw new HttpError(404, 'Not found');
});
router.add('GET', '/media/:id/outputs/:file', (req, res, { id, file }) => {
  const meta = getVideo(id);
  if (!isPlainSegment(file) || !meta.outputs.some((o) => o.file === file)) throw new HttpError(404, 'Not found');
  const full = path.join(videoDir(id), 'outputs', file);
  if (new URL(req.url, 'http://x').searchParams.has('download')) {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${id} - ${file}`)}`);
  }
  return serveFile(req, res, full);
});

async function handle(req, res) {
  const reason = rejectReason(req, port);
  if (reason) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end(`Forbidden: ${reason}`);
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const found = router.match(method, url.pathname);
  try {
    if (found) {
      const result = await found.handler(req, res, found.params);
      if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
      return;
    }
    if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Unknown endpoint');
    if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    serveFile(req, res, safeJoin(paths.ui, rel));
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message });
    else res.destroy();
  }
}

const server = http.createServer(handle);
server.requestTimeout = 0; // large uploads
server.headersTimeout = 60_000;

function listen() {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < PORT_END) {
          port += 1;
          attempt();
        } else reject(err);
      });
      server.listen(port, '127.0.0.1', resolve);
    };
    attempt();
  });
}

const stateFile = () => path.join(paths.state, 'server.json');

async function shutdown() {
  cancelRunning();
  broadcast('bye', {});
  try { fs.rmSync(stateFile(), { force: true }); } catch { /* ignore */ }
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown); // console window closed

async function main() {
  await loadLibrary();
  await loadQueue();
  await listen();
  await fsp.mkdir(paths.state, { recursive: true });
  await fsp.writeFile(stateFile(), JSON.stringify({ port, pid: process.pid, startedAt: new Date().toISOString() }));
  const url = `http://127.0.0.1:${port}/`;
  console.log(`LocalPress is running at ${url}`);
  if (OPEN_BROWSER) spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
  recheck().catch((err) => console.error('Tool check failed:', err.message));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
