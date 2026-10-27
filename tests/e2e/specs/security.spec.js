import { test, expect } from '@playwright/test';
import http from 'node:http';
import { mainServer } from '../helpers.js';

const { port } = new URL(mainServer.url);

// Raw requests so Host / Origin / Sec-Fetch-Site can be set to what an attacker's page would send.
function raw(method, p, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

test('foreign origins, hosts and cross-site loads are rejected', async () => {
  const host = `127.0.0.1:${port}`;
  expect(await raw('POST', '/api/quit', { Host: host, Origin: 'https://evil.example' })).toBe(403);
  expect(await raw('POST', '/api/tools/uninstall', { Host: host })).toBe(403);
  expect(await raw('GET', '/api/state', { Host: 'evil.example' })).toBe(403);
  expect(await raw('GET', '/api/state', { Host: host, 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
  expect(await raw('GET', '/media/x/thumb', { Host: host, 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
  expect(await raw('GET', '/api/state', { Host: host })).toBe(200);
});

test('a page on another origin cannot drive the server', async ({ page }) => {
  // A blank page on a different origin tries a state-changing request: CORS blocks reading it and
  // the server refuses it, so the server is still alive afterwards.
  await page.goto('about:blank');
  await page.evaluate(async (url) => {
    try { await fetch(`${url}api/quit`, { method: 'POST', mode: 'no-cors' }); } catch { /* expected */ }
  }, mainServer.url);
  const ping = await fetch(`${mainServer.url}api/ping`);
  expect(ping.status).toBe(200);
});

test('path traversal in media URLs is refused', async () => {
  const host = `127.0.0.1:${port}`;
  for (const p of ['/media/..%2F..%2Fapp/source', '/media/x/outputs/..%2F..%2Fmeta.json', '/..%2Fserver.js']) {
    expect([400, 403, 404]).toContain(await raw('GET', p, { Host: host }));
  }
});
