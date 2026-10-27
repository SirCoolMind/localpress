import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(E2E, '..', '..');
export const TMP = path.join(E2E, '.tmp');
export const NODE = path.join(ROOT, 'app', 'runtime', 'node', 'node.exe');
export const SERVER = path.join(ROOT, 'app', 'server.js');
export const TOOLS = path.join(ROOT, 'app', 'tools');
export const FFMPEG = path.join(TOOLS, 'ffmpeg', 'bin', 'ffmpeg.exe');
export const CLIPS = path.join(TMP, 'clips');

function serverEnv(name, port, extra = {}) {
  return {
    ...process.env,
    LOCALPRESS_PORT: String(port),
    LOCALPRESS_NO_OPEN: '1',
    LOCALPRESS_VIDEOS_DIR: path.join(TMP, name, 'videos'),
    LOCALPRESS_STATE_DIR: path.join(TMP, name, 'state'),
    LOCALPRESS_TOOLS_DIR: TOOLS,
    ...extra,
  };
}

// The server Playwright starts for most specs: real tools, a throwaway library.
export const mainServer = {
  url: 'http://127.0.0.1:7979/',
  command: `"${NODE}" "${SERVER}"`,
  env: serverEnv('main', 7979),
};

/** Starts an extra server for specs that need their own state (tools missing, crash recovery). */
export async function startServer(name, port, extra = {}, { fresh = true } = {}) {
  if (fresh) fs.rmSync(path.join(TMP, name), { recursive: true, force: true });
  const child = spawn(NODE, [SERVER], { env: serverEnv(name, port, extra), stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${url}api/ping`);
      if (r.ok) return { url, child, kill: () => killTree(child.pid), ready: () => toolsReady(url) };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  killTree(child.pid);
  throw new Error(`server ${name} did not start`);
}

export function killTree(pid) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
}

/** Calls the API the way the page does (same Origin), from Node. */
export async function call(base, method, p, body, headers = {}) {
  const res = await fetch(new URL(p, base), {
    method,
    headers: { Origin: base.replace(/\/$/, ''), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

export async function importFile(base, file, name = path.basename(file)) {
  const buf = fs.readFileSync(file);
  const res = await fetch(new URL('/api/import', base), {
    method: 'PUT',
    headers: { Origin: base.replace(/\/$/, ''), 'X-File-Name': encodeURIComponent(name) },
    body: buf,
  });
  if (!res.ok) throw new Error(`import failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function waitFor(fn, { timeout = 120_000, interval = 500 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Resolves once the server has found ffmpeg and finished testing encoders (it refuses imports until then). */
export function toolsReady(base) {
  return waitFor(async () => (await call(base, 'GET', '/api/state')).data.tools.ready, { timeout: 60_000 });
}

/** Empties the main server's library and queue so each spec starts clean. */
export async function resetLibrary(base = mainServer.url) {
  await toolsReady(base);
  const { data } = await call(base, 'GET', '/api/state');
  for (const j of data.queue.jobs) {
    if (j.status === 'running' || j.status === 'queued') await call(base, 'POST', `/api/queue/${j.id}/cancel`);
  }
  for (const v of data.library.videos) await call(base, 'DELETE', `/api/videos/${encodeURIComponent(v.id)}`);
  const after = await call(base, 'GET', '/api/state');
  for (const j of after.data.queue.jobs) await call(base, 'DELETE', `/api/queue/${j.id}`);
}
